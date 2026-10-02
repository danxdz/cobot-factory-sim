import { Vector3 } from '@babylonjs/core';

/** Frame-rate-independent blend, bounded so a slow frame cannot overshoot. */
export function responseBlend(rate: number, delta: number): number {
    return -Math.expm1(-Math.max(0, rate) * Math.max(0, delta));
}

/** Integrate one velocity response for the tool, after all safety constraints.
 * The analytic displacement preserves acceleration across different frame rates.
 */
export function integrateToolVelocity(
    velocity: Vector3,
    requestedVelocity: Vector3,
    delta: number,
    response: number,
    drag: number,
): Vector3 {
    if (!(delta > 0) || !Number.isFinite(delta)) return Vector3.Zero();
    const rate = Math.max(0, response) + Math.max(0, drag);
    if (rate <= 0) return velocity.scale(delta);
    const terminal = requestedVelocity.scale(Math.max(0, response) / rate);
    const transient = velocity.subtract(terminal);
    const blend = responseBlend(rate, delta);
    const displacement = terminal.scale(delta).add(transient.scale(blend / rate));
    velocity.copyFrom(terminal.add(transient.scale(1 - blend)));
    return displacement;
}
