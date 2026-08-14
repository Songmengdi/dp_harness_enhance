/**
 * dsh-user-turn-rail — user turn rail + conversation width tuning for the dsh web GUI.
 *
 * Host half: no-op. The capability is pure browser UI (Client half), so this
 * half only exists so the row can be mounted in the host composition and the
 * dsh client-modules table can discover `./client` from the package.json
 * `dsh.client` declaration.
 */
export const name = 'dsh-user-turn-rail'

export function apply() {}
