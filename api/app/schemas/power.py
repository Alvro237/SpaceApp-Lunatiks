"""Request and response models of POST /api/v1/power (MECH), following the team's API rules: flat field names.
snake_case JSON, units in descriptions.

No panel, battery or load value has a default: none has a cited source yet, so the caller gives them.
Fields marked "extra" are beyond the API rules and may be ignored by the frontend.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..logic.colony import METABOLIC_W_PER_CREW, SYNODIC_MONTH_H
from ..logic.power import ARRAY_KEYS, BATTERY_KEYS
from .common import TimeRange, WindowRequest, WindowResponse
from .thermal import RegolithIn

COLONY_KEYS = ("critical_load_w", "deferrable_load_w", "comms_load_w", "shed_soc", "max_charge_w", "max_discharge_w")
BATTERY_STORE_KEYS = tuple(k for k in BATTERY_KEYS if k != "load_w")


class PowerInputs(BaseModel):
    """Panel, battery and load parameters with the API rules' flat names (shared by /power and /sweep)."""
    panel_area_m2: float | None = Field(None, gt=0.0, description="Active solar array area, m2 (level 2+)")
    cell_efficiency: float | None = Field(None, gt=0.0, le=1.0, description="Array conversion efficiency, 0..1 (level 2+)")
    derating: float | None = Field(None, gt=0.0, le=1.0, description="Product of other losses, 0..1; 1 = none (level 2+)")
    load_w: float | None = Field(None, ge=0.0, description="Electrical load, W (level 3)")
    night_load_w: float | None = Field(None, ge=0.0, description="Extra: load while no Sun is visible, W; load_w when omitted")
    battery_capacity_wh: float | None = Field(None, gt=0.0, description="Nominal battery capacity, Wh (level 3)")
    battery_initial_soc: float | None = Field(None, ge=0.0, le=1.0, description="State of charge at start, 0..1 (level 3)")
    battery_min_soc: float | None = Field(None, ge=0.0, lt=1.0, description="Lowest allowed state of charge, 0..1 (level 3)")
    charge_efficiency: float | None = Field(None, gt=0.0, le=1.0, description="One-way charge efficiency, 0..1 (level 3)")
    discharge_efficiency: float | None = Field(None, gt=0.0, le=1.0, description="One-way discharge efficiency, 0..1 (level 3)")

    def _missing(self, keys) -> list[str]:
        return [k for k in keys if getattr(self, k) is None]

    def _partial(self, keys) -> bool:
        m = self._missing(keys)
        return 0 < len(m) < len(keys)


class HabitatIn(BaseModel):
    """Two-node habitat (level 4). Sun-facing area = 0.5 x area_m2 and ground view factor = 0.5 are fixed
    (team decision); every other value has no cited default, so the caller gives it."""
    crew_count: int = Field(ge=0, description="Crew members inside")
    t_set_k: float = Field(gt=0.0, description="Interior setpoint temperature held by the heater, K")
    t_min_k: float = Field(gt=0.0, description="Lowest safe interior temperature, K")
    ua_w_k: float = Field(gt=0.0, description="Thermal conductance of the insulation, interior to outer skin, W/K")
    area_m2: float = Field(gt=0.0, description="External (radiating) surface area, m2")
    skin_absorptivity: float = Field(gt=0.0, le=1.0, description="Solar absorptivity of the outer skin, 0..1")
    skin_emissivity: float = Field(gt=0.0, le=1.0, description="Infrared emissivity of the outer skin, 0..1")
    structure_mass_kg: float = Field(gt=0.0, description="Mass of structure and contents at interior temperature, kg")
    structure_specific_heat_j_kgk: float = Field(gt=0.0, description="Mean specific heat of that mass, J kg-1 K-1")
    air_volume_m3: float = Field(ge=0.0, description="Pressurised volume, m3")
    air_pressure_pa: float = Field(ge=0.0, description="Cabin pressure, Pa (Earth-like air composition assumed)")
    metabolic_w_per_crew: float = Field(METABOLIC_W_PER_CREW, ge=0.0, description=(
        "Metabolic heat per crew member, W; default 140.6 W = mean of the 40-year-old male and female rates of NASA "
        "BVAD Rev 1 (NASA/TP-2015-218570, 2018) Table 3-21"))

    @model_validator(mode="after")
    def _limits(self) -> "HabitatIn":
        if self.t_min_k >= self.t_set_k:
            raise ValueError("t_min_k must be below t_set_k")
        return self


class EnergyBreakdown(BaseModel):
    generated_wh: float = Field(description="Array energy over the window, Wh")
    critical_served_wh: float = Field(description="Critical load served (heater not included), Wh")
    heater_served_wh: float = Field(description="Heater energy served, Wh")
    comms_served_wh: float = Field(description="Comms load served, Wh")
    deferrable_served_wh: float = Field(description="Deferrable load served, Wh")
    critical_unserved_wh: float = Field(description="Critical load (with heater) not served, Wh")
    noncritical_unserved_wh: float = Field(description="Non-critical load asked for but not served, Wh")
    shed_wh: float = Field(description="Non-critical load switched off by the shedding rule, Wh")
    curtailed_wh: float = Field(description="Array energy not used: battery full or charge power limit, Wh")
    charge_losses_wh: float = Field(description="Energy lost charging (1 - charge efficiency), Wh")
    discharge_losses_wh: float = Field(description="Energy lost discharging, Wh")
    battery_change_wh: float = Field(description="Battery energy at the end minus at the start, Wh")


class PowerRequest(WindowRequest, PowerInputs):
    panel: Literal["tracking", "vertical", "horizontal"] = Field("vertical", description=(
        "Array orientation: always facing the Sun, vertical turning in azimuth, or flat on the ground"))
    level: Literal[1, 2, 3, 4] = Field(description=(
        "1 visible solar disc; 2 adds array power (panel_area_m2, cell_efficiency, derating); 3 adds the battery "
        "balance (load_w, battery_capacity_wh, battery_initial_soc, battery_min_soc, charge_efficiency, "
        "discharge_efficiency); 4 colony analysis: the battery fields without load_w, plus critical_load_w, "
        "deferrable_load_w, comms_load_w, shed_soc, max_charge_w, max_discharge_w and habitat (regolith optional); "
        "window of at least one synodic month (708.7 h)"))
    # level 4 (colony analysis, extension beyond the team's API rules)
    critical_load_w: float | None = Field(None, ge=0.0, description="Level 4: life support and other loads that must never stop, W (heater added by the model)")
    deferrable_load_w: float | None = Field(None, ge=0.0, description="Level 4: loads that can be switched off (science, rovers), W")
    comms_load_w: float | None = Field(None, ge=0.0, description="Level 4: Earth link load, drawn only while the Earth is visible, W")
    comms_critical: bool = Field(False, description="Level 4: treat the comms load as critical instead of deferrable")
    comms_min_fraction: float = Field(0.5, gt=0.0, le=1.0, description="Level 4: share of the Earth's disc needed for a link")
    shed_soc: float | None = Field(None, ge=0.0, lt=1.0, description="Level 4: below this state of charge the deferrable loads are switched off, 0..1")
    max_charge_w: float | None = Field(None, gt=0.0, description="Level 4: highest charging power the battery accepts (array side), W")
    max_discharge_w: float | None = Field(None, gt=0.0, description="Level 4: highest power the battery can deliver, W")
    habitat: HabitatIn | None = Field(None, description="Level 4: habitat thermal model")
    regolith: RegolithIn | None = Field(None, description=(
        "Level 4, optional: regolith properties for the ground temperature; default lunar values from Hayne et al. 2017"))
    include_sizing: bool = Field(True, description="Level 4: also search the smallest battery and array that survive independently")

    @model_validator(mode="after")
    def _check_level(self) -> "PowerRequest":
        missing = (self._missing(ARRAY_KEYS) if self.level >= 2 else []) + \
                  (self._missing(BATTERY_KEYS) if self.level == 3 else []) + \
                  (self._missing(BATTERY_STORE_KEYS + COLONY_KEYS + ("habitat",)) if self.level == 4 else [])
        if missing:
            raise ValueError(f"level {self.level} needs " + ", ".join(missing))
        if self.level == 4:
            if self.duration_h < SYNODIC_MONTH_H:
                raise ValueError(f"level 4 needs duration_h >= one synodic month ({SYNODIC_MONTH_H:.1f} h)")
            if self.shed_soc < self.battery_min_soc:
                raise ValueError("shed_soc must be at or above battery_min_soc")
        return self


class PowerResponse(WindowResponse):
    level: int
    panel: str
    # level 1 (API rules)
    sun_fraction: list[float] = Field(description="Fraction of the solar disc above the local horizon at each sample, 0..1")
    sun_el_deg: list[float] = Field(description="Solar elevation of the disc centre at each sample, degrees")
    sunlit_ranges: list[TimeRange]
    longest_dark_h: float = Field(description="Longest stretch with no part of the Sun visible, hours")
    # level 1 extras
    sunlit_fraction: float = Field(description="Extra: share of samples with any of the Sun visible, 0..1")
    obscuration: list[float] = Field(description="Extra: fraction of the solar disc covered by the Earth (eclipse), 0..1")
    eclipse_ranges: list[TimeRange] = Field(description="Extra: time ranges with the Earth covering part of the Sun")
    mean_power_w_m2: float = Field(description=(
        "Extra: mean solar power incident on 1 m2 of panel over the window (mean of irradiance_w_m2, eclipses "
        "included), W/m2. Needs no panel size, so it compares places directly; same as /sweep mean_power_w_m2"))
    # level 2 (API rules)
    irradiance_w_m2: list[float] | None = Field(None, description=(
        "Irradiance reaching the panel at each sample, W/m2: solar irradiance x visible fraction x panel orientation "
        "factor x (1 - eclipse obscuration)"))
    power_w: list[float] | None = Field(None, description="Array electrical power at each sample, W")
    mean_power_w: float | None = Field(None, description="Mean array power over the window, W")
    energy_wh: float | None = Field(None, description="Array energy over the window (left Riemann sum), Wh")
    # level 2 extras
    peak_power_w: float | None = Field(None, description="Extra: highest array power, W")
    eclipse_energy_loss_wh: float | None = Field(None, description="Extra: array energy lost to eclipses, Wh")
    # level 3 (API rules)
    net_power_w: list[float] | None = Field(None, description="Array power minus load at each sample, W")
    battery_soc: list[float] | None = Field(None, description="Battery state of charge at each sample, fraction of capacity")
    min_soc: float | None = Field(None, description="Lowest state of charge reached, fraction of capacity")
    survives: bool | None = Field(None, description="True when the load was always served")
    first_depletion_at: str | None = Field(None, description="First sample with load unserved, ISO 8601 UTC; null if it survives")
    energy_margin_wh: float | None = Field(None, description=(
        "Energy above the battery floor at the worst moment, Wh; negative = load energy that could not be served"))
    # level 3 extras
    load_profile_w: list[float] | None = Field(None, description="Extra: load applied at each sample, W")
    final_soc: float | None = Field(None, description="Extra: state of charge at the end, fraction")
    depleted_ranges: list[TimeRange] | None = Field(None, description="Extra: time ranges with load unserved")
    unserved_energy_wh: float | None = Field(None, description="Extra: load energy not served, Wh")
    curtailed_energy_wh: float | None = Field(None, description="Extra: array energy lost because the battery was full, Wh")
    usable_capacity_wh: float | None = Field(None, description="Extra: capacity x (1 - battery_min_soc), Wh")
    longest_dark_energy_wh: float | None = Field(None, description=(
        "Extra: battery energy to carry the night load through the longest dark stretch, Wh"))
    # level 4: colony analysis (extension; at level 4 the level-3 fields above come from the colony model:
    # load = critical + heater + non-shed loads, survives = critical load always served)
    colony_status: Literal["survives_independently", "survives_window_declining", "failure_after_x_days"] | None = \
        Field(None, description=(
            "survives_independently: no critical failure and the battery ends the last whole synodic month at least as "
            "full as it started (repeating the window never fails); survives_window_declining: no failure but the "
            "battery ends lower; failure_after_x_days: critical load unserved after failure_after_days"))
    failure_after_days: float | None = Field(None, description="Days from start to the first critical load not served")
    failure_at: str | None = Field(None, description="Time of that failure, ISO 8601 UTC")
    synodic_months: int | None = Field(None, description="Whole synodic months in the window, used for the status")
    month_soc_change: list[float] | None = Field(None, description="Battery state-of-charge change over each whole synodic month, fraction")
    critical_load_profile_w: list[float] | None = Field(None, description="Critical demand at each sample (critical load + heater, + comms if critical), W")
    heater_w: list[float] | None = Field(None, description="Heater electrical demand at each sample, W")
    cooling_demand_w: list[float] | None = Field(None, description="Heat in excess of the leak, to be rejected, W (electrical cost not modelled)")
    interior_k: list[float] | None = Field(None, description="Habitat interior temperature at each sample, K")
    skin_k: list[float] | None = Field(None, description="Habitat outer skin temperature at each sample, K")
    ground_k: list[float] | None = Field(None, description="Regolith surface temperature at each sample, K")
    autonomy_h: list[float | None] | None = Field(None, description=(
        "Hours the battery alone could carry the critical demand of that moment; null when that demand is zero"))
    sunrise_margin_wh: list[float | None] | None = Field(None, description=(
        "In the dark: battery energy above the floor minus what the critical demand needs until the next sunrise, Wh; "
        "null while sunlit or when no sunrise comes within the window"))
    shed_ranges: list[TimeRange] | None = Field(None, description="Degraded mode: time ranges with the deferrable loads off")
    degraded_days: float | None = Field(None, description="Total time in degraded mode, days")
    interior_below_min_ranges: list[TimeRange] | None = Field(None, description="Time ranges with the interior below t_min_k")
    energy_breakdown: EnergyBreakdown | None = None
    metabolic_heat_w: float | None = Field(None, description="Crew metabolic heat, W")
    habitat_heat_capacity_j_k: float | None = Field(None, description="Interior heat capacity (structure + air), J/K")
    unheated_equilibrium_k: float | None = Field(None, description=(
        "Interior temperature with all electrical power lost (crew heat only), at the coldest moment of the window, K"))
    cold_soak_h: float | None = Field(None, description=(
        "Hours from t_set_k to t_min_k with all electrical power lost, at the coldest moment; null if never reached"))
    min_battery_capacity_wh: float | None = Field(None, description=(
        "Smallest battery capacity that gives survives_independently with the given array; null if not reached at "
        "4096 x the given capacity or not requested"))
    min_panel_area_m2: float | None = Field(None, description=(
        "Smallest array area that gives survives_independently with the given battery; null if not reached"))
