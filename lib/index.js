/**
 * Host half of dsh-plugin-balance.
 *
 * The package contributes browser presentation only, exactly like
 * `@deepseek-ai/dsh-client-ui-brand-official`: this empty `apply` gives the
 * Cordis Loader a host-side row while the visible half ships through the
 * package's `./client` export and `dsh.client` declaration.
 */

/** Host plugin body — this package renders in the page, not in the process. */
export function apply() {}
