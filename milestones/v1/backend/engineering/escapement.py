"""Escapement + pendulum timing, from first principles (clock follow-on scaffold).

This module provides the timekeeping math now (so the AI can size a movement
correctly) plus a basic deadbeat escape-wheel generator. The full anchor/pallet
geometry and going-train assembly build on the gear + physics layers and are the
next milestone after the gear-train slice.

Pendulum timing
---------------
A simple pendulum's period (small-amplitude) is::

    T = 2*pi*sqrt(L/g)

so to keep accurate time we solve for the rod length ``L`` from the desired
period. A "seconds pendulum" (T = 2 s, one-second swing each way) needs
L ~= 0.994 m at g = 9.81 m/s^2.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from build123d import Cylinder, Polygon, Pos, extrude

G = 9.80665  # m/s^2, standard gravity


def pendulum_length_for_period(period_s: float, g: float = G) -> float:
    """Rod length (metres) for a target full period (small amplitude)."""
    if period_s <= 0:
        raise ValueError("period must be > 0")
    return g * (period_s / (2.0 * math.pi)) ** 2


def pendulum_period(length_m: float, g: float = G) -> float:
    """Full period (s) for a given pendulum length (metres)."""
    if length_m <= 0:
        raise ValueError("length must be > 0")
    return 2.0 * math.pi * math.sqrt(length_m / g)


def seconds_pendulum_length(g: float = G) -> float:
    """Length of a seconds pendulum (T = 2 s)."""
    return pendulum_length_for_period(2.0, g)


@dataclass(frozen=True)
class EscapementTiming:
    """Relate escape-wheel teeth + pendulum period to a 1 Hz-style seconds hand."""

    escape_teeth: int
    pendulum_period_s: float

    @property
    def beats_per_second(self) -> float:
        # Each full period the escapement advances by 2 teeth (one per swing).
        return 2.0 / self.pendulum_period_s

    @property
    def escape_revs_per_second(self) -> float:
        return self.beats_per_second / (2.0 * self.escape_teeth)

    @property
    def escape_seconds_per_rev(self) -> float:
        return 1.0 / self.escape_revs_per_second


def escape_wheel_solid(params: dict[str, Any]) -> Any:
    """A basic deadbeat-style escape wheel (axis = Z, z in [0, thickness]).

    Teeth are radial with an undercut leading face -- enough to drive a pallet in
    simulation. Params: teeth, tip_radius (mm), thickness, tooth_depth, bore.
    """
    teeth = int(params.get("teeth", 30))
    ra = float(params.get("tip_radius", params.get("radius", 30.0)))
    thickness = float(params.get("thickness", 3.0))
    depth = float(params.get("tooth_depth", ra * 0.12))
    bore = float(params.get("bore", 0.0))
    if teeth < 6 or ra <= 0 or thickness <= 0:
        raise ValueError("escape wheel needs teeth>=6, tip_radius>0, thickness>0")

    rf = ra - depth
    pitch = 2 * math.pi / teeth
    # Asymmetric tooth: steep impulse face + sloped back, characteristic of
    # recoil/deadbeat escapements.
    pts: list[tuple[float, float]] = []
    for i in range(teeth):
        a0 = i * pitch
        # tip
        pts.append((ra * math.cos(a0), ra * math.sin(a0)))
        # impulse (near-radial) drop to root just ahead of the tip
        a_imp = a0 + pitch * 0.12
        pts.append((rf * math.cos(a_imp), rf * math.sin(a_imp)))
        # sloped back face along the root to the next tooth
        a_back = a0 + pitch * 0.95
        pts.append((rf * math.cos(a_back), rf * math.sin(a_back)))

    face = Polygon(*pts, align=None)
    wheel = extrude(face, amount=thickness)
    if bore > 0:
        wheel = wheel - (Pos(0, 0, thickness / 2) * Cylinder(bore / 2.0, thickness * 2))
    return wheel


def escape_wheel_metadata(params: dict[str, Any]) -> dict[str, Any]:
    teeth = int(params.get("teeth", 30))
    period = float(params.get("pendulum_period_s", 2.0))
    t = EscapementTiming(escape_teeth=teeth, pendulum_period_s=period)
    return {
        "escape_teeth": teeth,
        "pendulum_period_s": period,
        "pendulum_length_m": pendulum_length_for_period(period),
        "beats_per_second": t.beats_per_second,
        "escape_seconds_per_rev": t.escape_seconds_per_rev,
    }
