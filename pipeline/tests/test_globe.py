"""The globe build refuses a PDS label that does not describe the product it expects."""
import pytest

from lunarnav.globe import _check_label

GOOD = """
    LINES = 2880
    LINE_SAMPLES = 5760
    SAMPLE_TYPE = LSB_INTEGER
    SAMPLE_BITS = 16
    SCALING_FACTOR = 0.5
    OFFSET = 1737400.
 MAP_RESOLUTION = 16 <pix/deg>
 A_AXIS_RADIUS = 1737.4 <km>
 POSITIVE_LONGITUDE_DIRECTION = "EAST"
 WESTERNMOST_LONGITUDE = 0 <deg>
 MAXIMUM_LATITUDE = 90 <deg>
 COORDINATE_SYSTEM_NAME = "MEAN EARTH/POLAR AXIS OF DE421"
"""


def test_accepts_the_expected_label():
    _check_label(GOOD)


@pytest.mark.parametrize("old,new", [("SCALING_FACTOR = 0.5", "SCALING_FACTOR = 1.0"),
                                     ("A_AXIS_RADIUS = 1737.4", "A_AXIS_RADIUS = 1738.0"),
                                     ("MEAN EARTH/POLAR AXIS", "PRINCIPAL AXIS")])
def test_rejects_another_datum_or_frame(old, new):
    with pytest.raises(ValueError):
        _check_label(GOOD.replace(old, new))
