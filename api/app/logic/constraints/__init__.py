"""Hard filters. Importing this package registers every constraint module listed below.

To add a constraint: create ``<name>.py`` next to these, decorate the function with
``@register("<id>")``, import the module here, add its threshold model to
``app/schemas/constraints.py`` and a test in ``tests/test_constraints.py``.
"""
from .base import (REGISTRY, ConstraintContext, ConstraintResult, all_pass, evaluate_constraints,  # noqa: F401
                   register)
from . import light, radiation, slope, temperature  # noqa: F401  (registration side effect)
