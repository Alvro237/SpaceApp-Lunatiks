"""Physical constants. Frame: Moon Mean-Earth / polar axis (MOON_ME), as in LOLA and Horizons."""
import math

MOON_R_KM = 1737.4            # LOLA / Horizons reference sphere
SUN_R_KM = 695_700.0          # IAU nominal solar radius
EARTH_R_KM = 6378.137         # equatorial radius
AU_KM = 149_597_870.7
SOLAR_CONSTANT_W_M2 = 1361.0  # total solar irradiance at 1 au
MS_PER_HOUR = 3_600_000
MS_PER_DAY = 86_400_000
SYNODIC_MONTH_DAYS = 29.530588  # sunrise to sunrise at a fixed lunar longitude
DEG = math.pi / 180.0
