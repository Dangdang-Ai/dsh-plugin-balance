/**
 * dsh-plugin-balance — browser half.
 *
 * The sidebar footer has no slot inside the account row, so this plugin takes
 * the footer's own `sidebar.footer.action` list seat to obtain a render position
 * in the sidebar shell, then portals the balance into the account menu trigger —
 * the button that holds the avatar — so the amount and its refresh control sit
 * to the right of the avatar on the same line.
 *
 * Anchor discovery never guesses a hashed class name: the seat renders a hidden
 * marker, and the account row is found by walking up from that marker until an
 * ancestor contains an avatar inside a button. That survives class-hash changes,
 * sidebar collapse, sign-in/out and React remounts of the account row.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const ReactDOM = require("react-dom");

		/** Client build identity for account Remote calls; only reaches a request header. */
		const CLIENT_VERSION = "0.2.0-rc.2";
		/** Re-read cadence while a page stays open, in milliseconds. */
		const REFRESH_MS = 60000;
		/** Trailing delay that coalesces DOM-mutation bursts into one anchor check. */
		const ANCHOR_DEBOUNCE_MS = 120;
		/** Safety-net anchor check for changes the observer cannot see. */
		const ANCHOR_POLL_MS = 2000;
		/** Marker attribute on the hidden element rendered into the footer seat. */
		const MARKER_ATTR = "data-dsh-balance-marker";
		/** Marker attribute on the span injected into the account trigger. */
		const HOST_ATTR = "data-dsh-balance-host";
		/** Attribute carrying the refresh control's own styling and state. */
		const ACTION_ATTR = "data-dsh-balance-action";
		/** Attribute on the clickable amount, which opens the threshold editor. */
		const AMOUNT_ATTR = "data-dsh-balance-amount";
		/** Attribute on the in-place threshold input. */
		const INPUT_ATTR = "data-dsh-balance-input";
		/** Browser preference holding the "turn red below this" amount. */
		const THRESHOLD_KEY = "dsh.balance.alertBelow";
		/** Colour of the whole chip while the balance is below the threshold. */
		const ALERT_COLOR = "var(--dsw-alias-state-error-primary,var(--dsw-alias-state-error-secondary,#e5484d))";
		/** Colour of the whole chip otherwise. */
		const IDLE_COLOR = "var(--dsw-alias-label-tertiary,currentColor)";

		//#region styles
		/**
		 * One stylesheet for the injected chip. Attribute selectors keep it clear
		 * of the shell's hashed class names, and every colour comes from a theme
		 * variable so light and dark follow the app.
		 */
		const css = [
			// The 2px drop is measured, not guessed: at 12px the font's ink centre
			// sits ~1.75px below its line-box centre, so a geometrically centred icon
			// reads as "too high" next to the amount. Dropping the control's own box
			// puts the glyph — and its hover square — on the amount's optical centre.
			// `color:inherit` keeps the icon on whatever colour the host carries, which
			// is how the whole chip turns red below the threshold.
			`[${ACTION_ATTR}]{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;border-radius:4px;color:inherit;cursor:pointer;pointer-events:auto;transform:translateY(2px)}`,
			`[${ACTION_ATTR}] svg{display:block}`,
			`[${ACTION_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
			`[${ACTION_ATTR}]:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}`,
			`[${ACTION_ATTR}][data-busy="true"]{cursor:default}`,
			`[${ACTION_ATTR}][data-busy="true"]:hover{background:none}`,
			`[${ACTION_ATTR}][data-busy="true"] svg{animation:dsh-balance-spin .8s linear infinite}`,
			`@keyframes dsh-balance-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`,
			`@media (prefers-reduced-motion:reduce){[${ACTION_ATTR}][data-busy="true"] svg{animation:none}}`,
			// The amount is the way in to the threshold: it is clickable and hints at
			// it on hover, while the rest of the chip stays inert.
			`[${AMOUNT_ATTR}]{pointer-events:auto;cursor:pointer}`,
			`[${AMOUNT_ATTR}]:hover{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}`,
			`[${INPUT_ATTR}]{pointer-events:auto;box-sizing:border-box;width:60px;font:inherit;font-size:12px;line-height:14px;color:inherit;text-align:right;background:0 0;border:0;border-bottom:1px solid currentColor;border-radius:0;padding:0 1px;outline:none}`,
			`[${INPUT_ATTR}]::placeholder{color:currentColor;opacity:.55}`
		].join("");
		/** Stylesheet tag id, so a page never carries two copies. */
		const cssTagId = "dsh-plugin-balance/Balance.module.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(cssTagId)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-balance";
			tag.dataset.pluginCss = cssTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		/** Currency symbol used by the account settings page. */
		function symbolOf(currency) {
			return currency === "USD" ? "$" : "\u00a5";
		}
		/**
		 * Parse a Platform decimal amount into exact millionths (1e-6 units) without
		 * touching binary floating point. `0.29 * 100` is `28.999999999999996` in
		 * IEEE 754, so the obvious `Number()` + `Math.trunc` formatting prints
		 * `0.28` for a `0.29` wallet — 4586 of the 99999 two-decimal values below
		 * 1000 are a cent low that way. Accepts Platform's decimal grammar,
		 * `-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`.
		 * @param text - decimal amount straight from Platform.
		 * @returns millionths as a BigInt, or null when the text is not a decimal.
		 */
		function toMillionths(text) {
			const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(text).trim());
			if (match === null) return null;
			const sign = match[1];
			const integer = match[2] ?? "";
			const fraction = match[3] ?? "";
			if (integer === "" && fraction === "") return null;
			const exponent = match[4] === void 0 ? 0 : Number(match[4]);
			// No wallet amount needs this; refusing keeps a hostile exponent from
			// materializing an enormous BigInt.
			if (!Number.isFinite(exponent) || Math.abs(exponent) > 30) return null;
			const scale = exponent - fraction.length + 6;
			let value = BigInt(`${integer}${fraction}`);
			if (scale > 0) value *= 10n ** BigInt(scale);
			else if (scale < 0) value /= 10n ** BigInt(-scale);
			return sign === "-" ? -value : value;
		}
		/** Group an integer digit string with thousands separators. */
		function addCommas(integer) {
			return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}
		/**
		 * Format exact millionths the way the account settings page does (Big.js
		 * `round(2, Big.roundDown)`): zero as `0.00`, a positive amount below one
		 * cent as `<0.01`, and anything else truncated — never rounded up.
		 * @param millionths - exact amount in 1e-6 units.
		 * @param symbol - currency symbol to prefix.
		 * @returns the display amount.
		 */
		function formatAmount(millionths, symbol) {
			const cent = 10000n;
			if (millionths === 0n) return `${symbol}0.00`;
			if (millionths < 0n) {
				const abs = -millionths;
				return `-${symbol}${abs < cent ? "0.01" : formatCents(abs / cent)}`;
			}
			if (millionths < cent) return `<${symbol}0.01`;
			return `${symbol}${formatCents(millionths / cent)}`;
		}
		/** Render whole cents as `1,234.56` without going through a float. */
		function formatCents(cents) {
			const fraction = String(cents % 100n).padStart(2, "0");
			return `${addCommas(String(cents / 100n))}.${fraction}`;
		}
		/**
		 * Fold recharge and bonus wallets into one total per currency.
		 * @param wallets - normal (recharge) wallets from the account Remote.
		 * @param bonusWallets - granted bonus wallets from the same result.
		 * @returns one row per currency, largest total first. Amounts stay exact
		 * millionths, so nothing rounds before the display truncation.
		 */
		function foldWallets(wallets, bonusWallets) {
			const rows = new Map();
			const add = (wallet, field) => {
				if (!wallet || typeof wallet.balance !== "string") return;
				const amount = toMillionths(wallet.balance);
				if (amount === null) return;
				const row = rows.get(wallet.currency) ?? { currency: wallet.currency, recharge: 0n, bonus: 0n };
				row[field] += amount;
				rows.set(wallet.currency, row);
			};
			for (const wallet of wallets ?? []) add(wallet, "recharge");
			for (const wallet of bonusWallets ?? []) add(wallet, "bonus");
			return [...rows.values()]
				.map((row) => ({ ...row, total: row.recharge + row.bonus }))
				.sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1));
		}
		/** The chip amount, or null when the account holds no wallet at all. */
		function chipText(rows) {
			if (rows.length === 0) return null;
			return rows.map((row) => formatAmount(row.total, symbolOf(row.currency))).join(" + ");
		}
		/** Tooltip naming the total and, when non-zero, each part behind it. */
		function chipTitle(rows, zh) {
			const lines = [];
			for (const row of rows) {
				const symbol = symbolOf(row.currency);
				const detail = [];
				if (row.recharge !== 0n) detail.push(`${zh ? "\u5145\u503c" : "Recharge"} ${formatAmount(row.recharge, symbol)}`);
				if (row.bonus !== 0n) detail.push(`${zh ? "\u8d60\u9001" : "Bonus"} ${formatAmount(row.bonus, symbol)}`);
				const head = `${zh ? "\u603b\u4f59\u989d" : "Total"} ${formatAmount(row.total, symbol)}`;
				lines.push(detail.length === 0 ? head : `${head}\uff08${detail.join(" \u00b7 ")}\uff09`);
			}
			return lines.join("\n");
		}
		/** The minimal clockwise refresh glyph. */
		function refreshIcon() {
			return React.createElement(
				"svg",
				{ width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
				React.createElement("path", {
					d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",
					stroke: "currentColor",
					strokeWidth: 2.2,
					strokeLinecap: "round"
				}),
				React.createElement("path", {
					d: "M21 3v5h-5",
					stroke: "currentColor",
					strokeWidth: 2.2,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);
		}
		//#endregion

		//#region threshold
		/**
		 * Read the persisted low-balance threshold.
		 * @returns the amount, or null when unset, cleared or unreadable.
		 */
		function readThreshold() {
			try {
				const raw = window.localStorage.getItem(THRESHOLD_KEY);
				if (raw === null) return null;
				const value = Number(raw);
				return Number.isFinite(value) && value > 0 ? value : null;
			} catch (error) {
				// Storage can be unavailable; the chip works without the preference.
				return null;
			}
		}
		/**
		 * Persist the low-balance threshold.
		 * @param value - the amount, or null to turn the alert off.
		 */
		function writeThreshold(value) {
			try {
				if (value === null) window.localStorage.removeItem(THRESHOLD_KEY);
				else window.localStorage.setItem(THRESHOLD_KEY, String(value));
			} catch (error) {
				// Same: a preference that cannot be saved never breaks the chip.
			}
		}
		//#endregion

		//#region anchor
		/**
		 * The account trigger inside one subtree: the button holding the account
		 * avatar. The account settings panel renders an avatar too, but not inside
		 * a button, so the "button contains avatar" shape is unique on the page.
		 * @param root - subtree to search.
		 * @returns the account trigger button, or null.
		 */
		function findAccountTrigger(root) {
			if (!root || typeof root.querySelector !== "function") return null;
			const avatar = root.querySelector('button [class*="_avatar"]');
			if (!avatar) return null;
			const button = avatar.closest("button");
			return button !== null && root.contains(button) ? button : null;
		}
		/**
		 * Walk up from the seat marker to the lowest ancestor holding the account
		 * row, so extra wrapper elements around the seat cannot break discovery.
		 * @param marker - the hidden element rendered into the footer seat.
		 * @returns the account trigger button, or null.
		 */
		function locateTrigger(marker) {
			let node = marker;
			while (node) {
				const trigger = findAccountTrigger(node);
				if (trigger !== null) return trigger;
				node = node.parentElement;
			}
			return null;
		}
		/**
		 * The row the account trigger sits in: the lowest flex ancestor above the
		 * button. The chip must not be appended *inside* the button — React
		 * re-creates the account label span on re-render and inserts it after any
		 * child it does not own, which puts the chip in front of the account name.
		 * The row above it is stable (its only React child is the settings launcher
		 * seat) and is `display:flex; align-items:center`, so an in-flow sibling
		 * lands on the name's line, keeps its own width reserved, and leaves the
		 * name to ellipsise first.
		 * @param trigger - the account trigger button.
		 * @returns the row to append to, or the button when no row is found.
		 */
		function locateContainer(trigger) {
			let node = trigger.parentElement;
			while (node !== null && node !== document.body) {
				if (window.getComputedStyle(node).display === "flex") return node;
				node = node.parentElement;
			}
			return trigger;
		}
		//#endregion

		//#region data
		/**
		 * Read the account balance on mount, on a cadence, whenever the page becomes
		 * visible again, and on demand from the refresh control.
		 * @param account - the `remote.account` service.
		 * @param locale - the client locale service.
		 * @returns the latest balance snapshot, the in-flight flag and a manual refresh.
		 */
		function useBalance(account, locale) {
			const [state, setState] = React.useState({ status: "loading" });
			const [busy, setBusy] = React.useState(false);
			const read = React.useCallback(async () => {
				try {
					const result = await account.getBalance({
						version: CLIENT_VERSION,
						locale: locale.getSnapshot().active,
						timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
					});
					const value = result === null || result === void 0 || !result.ok ? null : result.value;
					if (value === null || value === void 0) {
						setState({ status: "signed-out" });
						return;
					}
					if (value.status === "ready") {
						setState({ status: "ready", wallets: value.value, bonusWallets: value.bonusWallets });
						return;
					}
					// A failed read is not evidence that the balance became zero, so a
					// number already on screen stays, dimmed.
					setState((previous) => previous.status === "ready" ? { ...previous, status: "failed", stale: true } : { status: "failed" });
				} catch (error) {
					setState((previous) => previous.status === "ready" ? { ...previous, status: "failed", stale: true } : { status: "failed" });
				}
			}, [account, locale]);
			React.useEffect(() => {
				let alive = true;
				const run = () => {
					if (alive) read();
				};
				const onVisible = () => {
					if (document.visibilityState === "visible") run();
				};
				run();
				const timer = window.setInterval(run, REFRESH_MS);
				document.addEventListener("visibilitychange", onVisible);
				window.addEventListener("focus", onVisible);
				return () => {
					alive = false;
					window.clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
					window.removeEventListener("focus", onVisible);
				};
			}, [read]);
			const refresh = React.useCallback(async () => {
				setBusy(true);
				try {
					await read();
				} finally {
					setBusy(false);
				}
			}, [read]);
			return { state, busy, refresh };
		}
		//#endregion

		//#region component
		/**
		 * Footer seat occupant. The seat itself renders nothing visible: it carries
		 * the hidden marker the anchor search starts from, and the chip is portalled
		 * into the account trigger found from that marker.
		 * @param props - slot framework props plus the injected account services.
		 * @returns the marker and, once anchored, the portalled chip.
		 */
		function BalanceEntry({ wide, account, locale }) {
			const marker = React.useRef(null);
			const [host, setHost] = React.useState(null);
			const [threshold, setThreshold] = React.useState(readThreshold);
			const [editing, setEditing] = React.useState(false);
			const { state, busy, refresh } = useBalance(account, locale);
			React.useEffect(() => {
				writeThreshold(threshold);
			}, [threshold]);
			React.useEffect(() => {
				let current = null;
				let element = null;
				let pending = 0;
				const detach = () => {
					if (element !== null && element.parentNode !== null) element.parentNode.removeChild(element);
					element = null;
				};
				const ensure = () => {
					const seat = marker.current;
					const trigger = seat === null || seat === void 0 ? null : locateTrigger(seat);
					const container = trigger === null ? null : locateContainer(trigger);
					// Re-attach when the row changed *or* when React dropped our node
					// while re-rendering the row.
					if (container === current && element !== null && element.parentNode === container) return;
					detach();
					current = container;
					if (container !== null) {
						element = document.createElement("span");
						element.setAttribute(HOST_ATTR, "");
						element.style.cssText = [
							"display:inline-flex",
							"align-items:center",
							"gap:3px",
							"flex:none",
							"white-space:nowrap",
							"font-size:12px",
							"line-height:16px",
							"font-variant-numeric:tabular-nums",
							// `auto` keeps the chip at the row's right edge even if the
							// account block ever stops taking the free space itself.
							"margin-left:auto",
							// The amount stays inert so hovering the chip does not steal the
							// account row's hover state; only the refresh control reacts.
							"pointer-events:none",
							// Raise the group by 1px so the amount's ink centre, not just its
							// line box, lines up with the avatar and the account name.
							"transform:translateY(-1px)",
							"color:var(--dsw-alias-label-tertiary,currentColor)"
						].join(";");
						container.appendChild(element);
					}
					setHost(element);
				};
				// Mutation bursts (streaming text, menus) coalesce into one trailing
				// check; the interval covers anything the observer misses.
				const schedule = () => {
					if (pending !== 0) return;
					pending = window.setTimeout(() => {
						pending = 0;
						ensure();
					}, ANCHOR_DEBOUNCE_MS);
				};
				ensure();
				const observer = new MutationObserver(schedule);
				observer.observe(document.body, { childList: true, subtree: true });
				const timer = window.setInterval(ensure, ANCHOR_POLL_MS);
				return () => {
					observer.disconnect();
					window.clearInterval(timer);
					if (pending !== 0) window.clearTimeout(pending);
					detach();
					setHost(null);
				};
			}, []);
			const rows = state.status === "ready" || state.status === "failed" ? foldWallets(state.wallets, state.bonusWallets) : [];
			const amount = chipText(rows);
			const failed = state.status === "failed";
			const zh = String(locale.getSnapshot().active).toLowerCase().startsWith("zh");
			const label = zh ? "\u4f59\u989d" : "Balance";
			// Compare exactly: the threshold goes through the same decimal reader as
			// the wallets, so no float sneaks in at the boundary either. Any currency
			// below it raises the alert, which is the safe reading when a row shows
			// more than one.
			const thresholdMicros = threshold === null ? null : toMillionths(String(threshold));
			const alert = thresholdMicros !== null && rows.some((row) => row.total < thresholdMicros);
			const saveThreshold = (text) => {
				const value = Number(String(text).trim());
				setThreshold(Number.isFinite(value) && value > 0 ? value : null);
				setEditing(false);
			};
			const thresholdNote = threshold === null
				? (zh ? "\u70b9\u51fb\u91d1\u989d\u8bbe\u4f4e\u4e8e\u591a\u5c11\u53d8\u7ea2" : "Click the amount to set when it turns red")
				: (zh
					? `\u4f4e\u4e8e ${formatAmount(thresholdMicros, symbolOf(rows[0] && rows[0].currency))} \u53d8\u7ea2\uff0c\u70b9\u51fb\u91d1\u989d\u4fee\u6539`
					: `Turns red below ${formatAmount(thresholdMicros, symbolOf(rows[0] && rows[0].currency))} \u2014 click the amount to change`);
			const hint = failed && amount === null
				? (zh ? "\u4f59\u989d\u8bfb\u53d6\u5931\u8d25\uff0c\u70b9\u51fb\u91cd\u8bd5" : "Balance unavailable \u2014 click to retry")
				: (amount === null ? "" : [chipTitle(rows, zh), thresholdNote, zh ? "\u70b9\u51fb \u27f3 \u5237\u65b0" : "Click \u27f3 to refresh"].join("\n"));
			React.useEffect(() => {
				if (host === null) return;
				host.style.display = wide && (amount !== null || failed) ? "" : "none";
				host.style.opacity = state.stale === true ? "0.55" : "";
				host.style.color = alert ? ALERT_COLOR : IDLE_COLOR;
				host.title = hint;
			}, [host, wide, amount, failed, hint, state.stale, alert]);
			const seat = React.createElement("span", {
				ref: marker,
				[MARKER_ATTR]: "",
				"aria-hidden": "true",
				style: { display: "none" }
			});
			const show = amount !== null || failed;
			const amountNode = amount === null ? null : (editing ? React.createElement("input", {
				key: "threshold",
				[INPUT_ATTR]: "",
				type: "text",
				inputMode: "decimal",
				defaultValue: threshold === null ? "" : String(threshold),
				placeholder: zh ? "\u9608\u503c" : "Alert",
				"aria-label": zh ? "\u4f59\u989d\u63d0\u9192\u9608\u503c" : "Low balance threshold",
				autoFocus: true,
				onClick: (event) => event.stopPropagation(),
				onKeyDown: (event) => {
					if (event.key === "Enter") saveThreshold(event.currentTarget.value);
					else if (event.key === "Escape") {
						// Blur follows the unmount in some browsers; remember the cancel.
						event.currentTarget.setAttribute("data-cancelled", "true");
						setEditing(false);
					}
				},
				onBlur: (event) => {
					if (event.currentTarget.getAttribute("data-cancelled") !== "true") saveThreshold(event.currentTarget.value);
				}
			}) : React.createElement("span", {
				key: "amount",
				[AMOUNT_ATTR]: "",
				role: "button",
				tabIndex: 0,
				"aria-label": zh ? "\u8bbe\u7f6e\u4f59\u989d\u63d0\u9192\u9608\u503c" : "Set the low balance threshold",
				onClick: () => setEditing(true),
				onKeyDown: (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					setEditing(true);
				}
			}, `${label} ${amount}`));
			const chip = show ? [
				amountNode,
				React.createElement("span", {
					key: "refresh",
					[ACTION_ATTR]: "",
					role: "button",
					tabIndex: 0,
					"data-busy": busy ? "true" : "false",
					"aria-label": zh ? "\u5237\u65b0\u4f59\u989d" : "Refresh balance",
					onClick: (event) => {
						event.stopPropagation();
						if (busy) return;
						refresh().catch(() => void 0);
					},
					onKeyDown: (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						event.stopPropagation();
						if (busy) return;
						refresh().catch(() => void 0);
					}
				}, refreshIcon())
			] : null;
			return React.createElement(
				React.Fragment,
				null,
				seat,
				host !== null && chip !== null ? ReactDOM.createPortal(chip, host) : null
			);
		}
		//#endregion

		/** Services required by the balance chip. */
		const inject = ["slots", "remote", "remote.account", "locale"];

		/**
		 * Register the sidebar footer seat occupant.
		 * @param ctx - client plugin context.
		 */
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "account-balance",
				order: 0,
				inject: () => ({ account: ctx.remote.account, locale: ctx.locale })
			}, BalanceEntry));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
