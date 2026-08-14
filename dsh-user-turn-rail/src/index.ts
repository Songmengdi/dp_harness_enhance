/**
 * dsh-user-turn-rail — host half.
 *
 * The capability is pure browser UI (the client half, `./client`): a
 * vertically centered rail of user-turn bars at the left edge of the
 * conversation column, plus tiered content-width breakpoints.
 *
 * This row exists so the host Loader mounts the composition row and the
 * client-modules scanner discovers the `./client` bundle through the
 * package.json `dsh.client` declaration. The host has nothing to own here:
 * the rail reads its state from the framework session kit inside the
 * browser, and the design constants live in the client bundle's CSS.
 *
 * @module dsh-user-turn-rail
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-user-turn-rail'

/** Host plugin body: a deliberate no-op (see the module doc). */
export function apply(_ctx: Context): void {}
