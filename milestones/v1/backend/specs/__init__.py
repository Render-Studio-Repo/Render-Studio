"""Real-world hardware specification library.

Each component is a versioned data file (YAML) describing exact published
dimensions, tolerances, mounting features, connectors, and keep-out zones, with
provenance (datasheet URL + revision). Engineering generators (e.g. enclosures)
consume these to guarantee dimensional fidelity and fit.
"""

from backend.specs.registry import (
    BoardSpec,
    ComponentSpec,
    Connector,
    MountingHole,
    available_specs,
    get_spec,
    load_spec,
)

__all__ = [
    "BoardSpec",
    "ComponentSpec",
    "Connector",
    "MountingHole",
    "available_specs",
    "get_spec",
    "load_spec",
]
