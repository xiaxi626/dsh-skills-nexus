window.__ModuleLoader__.load({
	id: "dsh-skills-nexus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/import-decision.ts
		function describeDecision(entry) {
			if (entry.decision.kind === "git") return `will clone from ${entry.decision.url} (${entry.decision.ref})`;
			switch (entry.decision.reason) {
				case "unreachable": return "will import as snapshot (remote unreachable)";
				case "timeout": return "will import as snapshot (remote check timed out)";
				case "no-remote": return "will import as snapshot (--no-remote)";
				case "not-checked": return "will import as snapshot (remote not checked)";
				default: return "will import as snapshot (source unknown)";
			}
		}
		//#endregion
		//#region src/client/api.ts
		/** One envelope-level failure: status + `{ error, data? }` (§7.1 约定 2/4). */
		var ApiError = class extends Error {
			status;
			error;
			data;
			constructor(status, error, data) {
				super(`${status} ${error}`);
				this.status = status;
				this.error = error;
				this.data = data;
				this.name = "ApiError";
			}
		};
		async function request(fetchImpl, path, init) {
			const res = await fetchImpl(path, init);
			let body;
			try {
				body = await res.json();
			} catch {
				throw new ApiError(res.status, "invalid-response");
			}
			if (res.status < 200 || res.status >= 300) {
				const env = body;
				throw new ApiError(res.status, typeof env?.error === "string" ? env.error : "unknown-error", env?.data);
			}
			const env = body;
			if (env === null || typeof env !== "object" || !("data" in env)) throw new ApiError(res.status, "invalid-envelope");
			return {
				data: env.data,
				hotReload: env.hotReload
			};
		}
		function postJson(fetchImpl, path, body) {
			return request(fetchImpl, path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
		}
		/** The filename header of the raw-body package upload (routes.ts, §10.3). */
		const FILENAME_HEADER = "x-nexus-filename";
		/**
		* `POST /import` with the chosen file as the raw body: the options ride in the
		* query string and the filename in a header, because the body is the package
		* itself. One helper serves both shapes — the synchronous `dryRun` preview and
		* the `202` job — so the two calls cannot drift in how they encode the upload.
		*/
		function postPackage(fetchImpl, file, opts) {
			const query = new URLSearchParams();
			for (const [key, value] of Object.entries(opts)) {
				if (value === void 0) continue;
				query.set(key, String(value));
			}
			return request(fetchImpl, `/skills-nexus/import?${query.toString()}`, {
				method: "POST",
				headers: {
					"content-type": "application/octet-stream",
					[FILENAME_HEADER]: file.name
				},
				body: file
			});
		}
		/**
		* Build the api object over an injectable transport. The default binds the
		* global `fetch` (the browser half runs same-origin — paths only, no host).
		*/
		function createApi(fetchImpl = (input, init) => fetch(input, init)) {
			return {
				list: () => request(fetchImpl, "/skills-nexus/list"),
				doctor: () => request(fetchImpl, "/skills-nexus/doctor"),
				add: (body) => postJson(fetchImpl, "/skills-nexus/add", body),
				importPreview: (file, opts = {}) => postPackage(fetchImpl, file, {
					...opts,
					dryRun: true,
					confirm: false
				}),
				importPackage: (file, opts = {}) => postPackage(fetchImpl, file, {
					...opts,
					dryRun: false,
					confirm: true
				}),
				adopt: (body) => postJson(fetchImpl, "/skills-nexus/adopt", body),
				remove: (name, confirm) => postJson(fetchImpl, "/skills-nexus/remove", {
					name,
					confirm: confirm === true
				}),
				update: (name, confirm) => postJson(fetchImpl, "/skills-nexus/update", {
					name,
					confirm: confirm === true
				}),
				checkUpdates: () => postJson(fetchImpl, "/skills-nexus/check-updates", {}),
				switchVersion: (body) => postJson(fetchImpl, "/skills-nexus/switch-version", body),
				toggle: (name, enabled) => postJson(fetchImpl, "/skills-nexus/toggle", {
					name,
					enabled
				}),
				job: (id) => request(fetchImpl, `/skills-nexus/job?id=${encodeURIComponent(id)}`),
				cancelJob: (id) => postJson(fetchImpl, "/skills-nexus/job/cancel", { id }),
				export: (body) => postJson(fetchImpl, "/skills-nexus/export", body)
			};
		}
		const CONFIRM_REQUIRED = "confirm-required";
		/** True for the `409 confirm-required` dialect the destructive routes answer. */
		function isConfirmRequired(err) {
			return err instanceof ApiError && err.status === 409 && err.error === CONFIRM_REQUIRED;
		}
		/** The `data.question` of a confirm-required error, when present. */
		function confirmQuestion(err) {
			if (!isConfirmRequired(err)) return void 0;
			const q = err.data?.question;
			return typeof q === "string" && q.length > 0 ? q : void 0;
		}
		/**
		* The ask-then-retry flow: run `fn(false)`; on a confirm-required answer show
		* the server's question through `ask`, and — only if the user accepts — run
		* `fn(true)`. Any other error propagates; a declined ask resolves `undefined`.
		*/
		async function confirmable(fn, ask) {
			try {
				return await fn(false);
			} catch (err) {
				const question = confirmQuestion(err);
				if (question === void 0) throw err;
				if (!await ask(question)) return void 0;
				return await fn(true);
			}
		}
		/** The question inside an errored job (`NeedsConfirm` → job error, §7.5). */
		function jobConfirmationQuestion(job) {
			if (job.status !== "error" || job.error === void 0) return void 0;
			return job.error.startsWith("confirmation required: ") ? job.error.slice(23) : void 0;
		}
		/** `pollJob` gave up waiting — the job is still `running` past `maxWaitMs`. */
		var PollTimeoutError = class extends Error {
			job;
			constructor(job) {
				super(`job ${job.id} is still running`);
				this.job = job;
				this.name = "PollTimeoutError";
			}
		};
		/**
		* Poll `GET /job?id=` until the job leaves `running`. Resolves the settled
		* job; throws `PollTimeoutError` (carrying the last snapshot) past the
		* deadline — the job itself keeps running server-side and can still be
		* cancelled or found by a later poll.
		*/
		async function pollJob(api, id, opts = {}) {
			const interval = opts.intervalMs ?? 1e3;
			const deadline = Date.now() + (opts.maxWaitMs ?? 6e5);
			const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
			for (;;) {
				const { data } = await api.job(id);
				opts.onTick?.(data.job);
				if (data.job.status !== "running") return data.job;
				if (Date.now() >= deadline) throw new PollTimeoutError(data.job);
				await sleep(interval);
			}
		}
		/** `reconcileList` gave up before the list reflected the mutation. */
		var ReconcileTimeoutError = class extends Error {
			entries;
			constructor(entries) {
				super("the list did not reflect the change in time");
				this.entries = entries;
				this.name = "ReconcileTimeoutError";
			}
		};
		/**
		* §11 reconciliation for a `hotReload: 'pending'` mutation: poll `list` until
		* `until` accepts the snapshot — i.e. the link change the host watcher is
		* about to confirm is visible. Resolves the accepted snapshot; throws
		* `ReconcileTimeoutError` (carrying the last snapshot) past the deadline —
		* the caller downgrades to a manual-refresh hint.
		*/
		async function reconcileList(api, until, opts = {}) {
			const interval = opts.intervalMs ?? 250;
			const deadline = Date.now() + (opts.timeoutMs ?? 2e3);
			const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
			for (;;) {
				const { data } = await api.list();
				if (until(data.entries)) return data.entries;
				opts.onTick?.(data.entries);
				if (Date.now() >= deadline) throw new ReconcileTimeoutError(data.entries);
				await sleep(interval);
			}
		}
		//#endregion
		//#region \0dsh-css:C:\Users\asswsw\Downloads\dsh-skills-nexus\src\client\panel.module.css.mjs
		const css = ".aqGPsq_section{width:100%;max-width:860px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;font-size:13px;line-height:20px;display:flex}.aqGPsq_lede{color:var(--dsw-alias-label-secondary);margin:0}.aqGPsq_groupTitle{letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;font-weight:600}.aqGPsq_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.aqGPsq_mono{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace, monospace)}.aqGPsq_notice,.aqGPsq_error{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);white-space:pre-wrap;align-items:center;gap:8px;margin:0;padding:8px 10px;display:flex}.aqGPsq_error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}.aqGPsq_install{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:10px;padding:12px;display:flex}.aqGPsq_formRow{align-items:center;gap:8px;display:flex}.aqGPsq_formRow>:first-child{flex:auto;min-width:0}.aqGPsq_fieldLabel{min-width:0;color:var(--dsw-alias-label-tertiary);flex-direction:column;flex:1 1 0;gap:4px;font-size:12px;display:flex}.aqGPsq_optional{color:var(--dsw-alias-label-tertiary);border:0;margin:0;padding:0}.aqGPsq_optional summary{cursor:pointer;padding:2px 0}.aqGPsq_optionalGrid{gap:10px;padding-top:8px;display:flex}.aqGPsq_toolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.aqGPsq_toolbarSpacer{flex:auto}.aqGPsq_search{flex:220px;min-width:0}.aqGPsq_entries{flex-direction:column;margin:0;padding:0;list-style:none;display:flex}.aqGPsq_entryRow{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:6px;padding:10px 0;display:flex}.aqGPsq_entryRow:last-child{border-bottom:0}.aqGPsq_entryHead{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.aqGPsq_entryName{color:var(--dsw-alias-label-primary);font-weight:600}.aqGPsq_entryMeta{color:var(--dsw-alias-label-tertiary);font-size:12px}.aqGPsq_updateArrow{color:var(--dsw-alias-state-warn-primary);font-size:12px}.aqGPsq_entryActions{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.aqGPsq_pinRow{align-items:center;gap:6px;padding:4px 0 2px;display:flex}.aqGPsq_pinInput{flex:0 240px;min-width:0}.aqGPsq_links{color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;gap:4px 10px;margin:0;padding:0 0 0 18px;font-size:12px;list-style:none;display:flex}.aqGPsq_linkOff{color:var(--dsw-alias-label-dimmed)}.aqGPsq_plan{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:6px;padding:10px;display:flex}.aqGPsq_planList{margin:0;padding-left:18px}.aqGPsq_jobs{flex-direction:column;gap:8px;display:flex}.aqGPsq_jobHead{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;display:flex}.aqGPsq_history{color:var(--dsw-alias-label-secondary);margin:0;padding-left:18px;font-size:12px}.aqGPsq_health{border-top:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;padding-top:8px;font-size:12px;display:flex}.aqGPsq_footer{border-top:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);margin:0;padding-top:8px;font-size:12px}.aqGPsq_empty{color:var(--dsw-alias-label-tertiary);margin:0;padding:4px 0}";
		const tagId = "dsh-skills-nexus/panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skills-nexus";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var panel_module_css_default = {
			"empty": "aqGPsq_empty",
			"entries": "aqGPsq_entries",
			"entryActions": "aqGPsq_entryActions",
			"entryHead": "aqGPsq_entryHead",
			"entryMeta": "aqGPsq_entryMeta",
			"entryName": "aqGPsq_entryName",
			"entryRow": "aqGPsq_entryRow",
			"error": "aqGPsq_error",
			"fieldLabel": "aqGPsq_fieldLabel",
			"footer": "aqGPsq_footer",
			"formRow": "aqGPsq_formRow",
			"groupTitle": "aqGPsq_groupTitle",
			"health": "aqGPsq_health",
			"hint": "aqGPsq_hint",
			"history": "aqGPsq_history",
			"install": "aqGPsq_install",
			"jobHead": "aqGPsq_jobHead",
			"jobs": "aqGPsq_jobs",
			"lede": "aqGPsq_lede",
			"linkOff": "aqGPsq_linkOff",
			"links": "aqGPsq_links",
			"mono": "aqGPsq_mono",
			"notice": "aqGPsq_notice",
			"optional": "aqGPsq_optional",
			"optionalGrid": "aqGPsq_optionalGrid",
			"pinInput": "aqGPsq_pinInput",
			"pinRow": "aqGPsq_pinRow",
			"plan": "aqGPsq_plan",
			"planList": "aqGPsq_planList",
			"search": "aqGPsq_search",
			"section": "aqGPsq_section",
			"toolbar": "aqGPsq_toolbar",
			"toolbarSpacer": "aqGPsq_toolbarSpacer",
			"updateArrow": "aqGPsq_updateArrow"
		};
		//#endregion
		//#region src/client/panel.tsx
		/**
		* The Settings panel: entry-granularity skill rows, an add form (git url), the
		* package-import row, the job progress view and the destructive-action confirm
		* flow.
		*
		* The panel mirrors the command surface: an add form (git url, with the
		* optional name / ref / subdir channels), the **package import row** (pick a
		* file → synchronous `--dry-run` preview → confirm → `202` job), an **"attach
		* source" action on source-less entries only** (`adopt`), an **export all**
		* button, and the job progress view. The destructive-action confirm flow takes
		* its wording from the server: the `409 confirm-required` question is the single
		* source of consequence text, and the panel only asks and retries. The preview
		* renders the four verdicts of the import decision through `describeDecision`,
		* the same function the CLI's `--dry-run` uses.
		*
		* ## Presentation
		*
		* **Atoms come from the host, layout comes from CSS Modules, theme comes from
		* `--dsw-*` tokens.** That is the platform's own arrangement, not a choice made
		* here: the host's primitives are "Cordis-free React primitives styled only
		* through `--dsw-*` tokens", and the host's client build compiles
		* `x.module.css` into a hashed class map plus a self-injecting `<style>` tag.
		*
		* So `StateDot` / `Button` / `Tag` / `Switch` / `Input` / `DisclosureRow` /
		* `TerminalBlock` / `RiskConfirmation` arrive already themed and already
		* accessible, and `panel.module.css` only *positions* them: density, spacing
		* and the row rhythm. The design draft's fixed three-hex-accent styling system
		* is deliberately not implemented — it would need per-theme maintenance and
		* would not follow the shell.
		*
		* `@deepseek-ai/dsh-client-ui-primitives` is one of the nine specifiers the
		* browser loader's `require` can answer (see `PLATFORM_MODULES` in
		* `tsdown.config.ts`), so importing it here costs the bundle nothing and ships
		* no second copy.
		*
		* ## Reconciliation
		*
		* A mutation marked `hotReload: 'pending'` polls the list (2s budget) until the
		* change is visible; `done` refreshes once; `unsupported` — the preserved
		* contract for watcher-less hosts — explains the restart downgrade.
		* `reconcileAfter` is the single funnel for all three.
		*/
		/** Reconciliation for `import`: every entry the plan promised shows up. */
		function importedAll(plan) {
			const wanted = plan.entries.map((e) => e.name);
			return (entries) => wanted.every((name) => entries.some((e) => e.name === name));
		}
		const shortSha = (sha) => sha === null ? "" : sha.slice(0, 7);
		/** Map route errors to one-line user-readable text (codes are the route contract). */
		function errorText(err) {
			if (err instanceof ApiError) switch (err.error) {
				case "busy": return `"${err.data?.name ?? "skill"}" has another operation in flight — try again shortly`;
				case "locked": return `locked by another process (pid ${err.data?.pid ?? "?"}), likely a CLI command — retry once it exits`;
				case "already-registered": return "a skill with this name is already registered";
				case "collision": return "a file or directory with this name already exists in the skills root";
				case "not-a-git-clone": return "this entry has no git source — remove it and install it again from its repository";
				case "already-has-source": return "this entry already has a git source — to re-source it, re-run from the CLI with --force";
				case "skill-mismatch": return "the new source yields different skills than the snapshot — if that is intended, re-run from the CLI with --force";
				case "ref-not-found": return "the ref does not exist on the remote";
				case "not-found": return "no such skill — the list may be stale, refresh it";
				case "untrusted origin": return "request blocked: untrusted origin";
				case "export-failed": return err.data?.message ?? "the export failed — refresh and try again";
				default: return `${err.status} ${err.error}`;
			}
			return err instanceof Error ? err.message : String(err);
		}
		/**
		* Lift the adopt backup path out of the settled job's output into a panel
		* notice. The route emits it as one output line (`previous directory kept as
		* <path>`); the wording below mirrors the CLI's own advice — delete it once
		* the new source looks right, doctor lists it until then.
		*/
		function adoptBackupNotice(job) {
			for (const line of job.output) {
				const match = /previous directory kept as (.+?)\s*$/.exec(line);
				if (match !== null) return `the previous directory is kept at ${match[1]} — delete it once the new source looks right (the CLI's doctor lists it until then)`;
			}
			return null;
		}
		/** One entry's row state, as the status dot reports it. */
		function entryState(entry) {
			if (!entry.hasGitSource) return "idle";
			if (!entry.enabled) return "idle";
			if (entry.update?.hasUpdate === true) return "warning";
			return "done";
		}
		/** The one-line health summary under the list. */
		function healthSummary(report) {
			const { errors, warnings, updates } = report.summary;
			const parts = [`${errors} error(s)`, `${warnings} warning(s)`];
			if (updates > 0) parts.push(`${updates} update(s) available`);
			return {
				state: errors > 0 ? "error" : warnings > 0 || updates > 0 ? "warning" : "done",
				text: parts.join(" · ")
			};
		}
		/** add: a name outside the pre-mutation baseline appears. */
		function appearsNewName(baseline) {
			return (entries) => entries.some((e) => !baseline.has(e.name));
		}
		/** remove: the entry disappears from the list. */
		function goneFrom(name) {
			return (entries) => !entries.some((e) => e.name === name);
		}
		/** toggle: the entry's enabled flag reaches `target`. */
		function flipsTo(name, target) {
			return (entries) => entries.some((e) => e.name === name && e.enabled === target);
		}
		/**
		* update/switch-version: the entry survives the operation. A strict predicate
		* (commit changed) would falsely time out on no-op runs (already up to date),
		* so the sanity check is deliberately the weaker "still listed".
		*/
		function stillListed(name) {
			return (entries) => entries.some((e) => e.name === name);
		}
		/** Does the entry match the search box? Case-insensitive name / url / subdir. */
		function matchesQuery(entry, query) {
			const q = query.trim().toLowerCase();
			if (q.length === 0) return true;
			return entry.name.toLowerCase().includes(q) || entry.url.toLowerCase().includes(q) || (entry.subdir ?? "").toLowerCase().includes(q);
		}
		/**
		* The panel. `api` is injectable for tests; production builds bind the global
		* fetch. The instance MUST be render-stable: a per-render `createApi()` default
		* would change `refresh`'s identity every render, re-fire the list effect, and
		* loop the panel in a self-sustaining fetch storm. Lazy useState pins it for
		* the mount's lifetime; the prop stays the injection seam.
		*/
		function NexusPanel({ api: apiProp }) {
			const [api] = (0, react.useState)(() => apiProp ?? createApi());
			const [entries, setEntries] = (0, react.useState)([]);
			const [listError, setListError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [notice, setNotice] = (0, react.useState)(null);
			const [jobs, setJobs] = (0, react.useState)([]);
			const [addUrl, setAddUrl] = (0, react.useState)("");
			const [addBusy, setAddBusy] = (0, react.useState)(false);
			/** Collapsed optional add channels: name override / ref / subdir. */
			const [addOptionsOpen, setAddOptionsOpen] = (0, react.useState)(false);
			const [addName, setAddName] = (0, react.useState)("");
			const [addRef, setAddRef] = (0, react.useState)("");
			const [addSubdir, setAddSubdir] = (0, react.useState)("");
			const [checking, setChecking] = (0, react.useState)(false);
			const [exportBusy, setExportBusy] = (0, react.useState)(false);
			const [refInputs, setRefInputs] = (0, react.useState)({});
			const [adoptInputs, setAdoptInputs] = (0, react.useState)({});
			const [adoptSubdirInputs, setAdoptSubdirInputs] = (0, react.useState)({});
			/** The chosen package file — kept so the confirmed run can re-send it. */
			const [importFile, setImportFile] = (0, react.useState)(null);
			/** The synchronous `--dry-run` verdict, once previewed. */
			const [importPlan, setImportPlan] = (0, react.useState)(null);
			const [importBusy, setImportBusy] = (0, react.useState)(false);
			/** Name/url filter over the rendered rows (client-side; touches no state). */
			const [query, setQuery] = (0, react.useState)("");
			/** The last `doctor` result, or null before the first check. */
			const [health, setHealth] = (0, react.useState)(null);
			const [healthBusy, setHealthBusy] = (0, react.useState)(false);
			/**
			* The entry awaiting a destructive-action decision. `RiskConfirmation` is a
			* controlled overlay, so the question stays on screen until answered — the
			* one interaction `window.confirm` could not express.
			*/
			const [pendingRemoval, setPendingRemoval] = (0, react.useState)(null);
			const [removalAcknowledged, setRemovalAcknowledged] = (0, react.useState)(false);
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			const refresh = (0, react.useCallback)(async () => {
				setLoading(true);
				try {
					const env = await api.list();
					if (!alive.current) return;
					setEntries(env.data.entries);
					setListError(null);
				} catch (err) {
					if (alive.current) setListError(errorText(err));
				} finally {
					if (alive.current) setLoading(false);
				}
			}, [api]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const patchJob = (0, react.useCallback)((id, job, stalled = false) => {
				setJobs((prev) => {
					const next = prev.map((t) => t.job.id === id ? {
						...t,
						job,
						stalled
					} : t);
					return next.some((t) => t.job.id === id) ? next : [...next, {
						job,
						entryName: job.name
					}];
				});
			}, []);
			/**
			* Reconciliation funnel for a mutation. `pending` (or a missing field from an
			* older server): poll the list until `until` accepts a snapshot. `done`: the
			* mutation never woke the watcher — one refresh suffices. `unsupported` (the
			* preserved contract for hosts without a watcher): say plainly that the change
			* lands on the next host start. A timeout downgrades to the manual-refresh
			* hint while the last snapshot stays on screen.
			*/
			const reconcileAfter = (0, react.useCallback)(async (label, hotReload, until) => {
				if (hotReload === "done") {
					await refresh();
					return;
				}
				if (hotReload === "unsupported") {
					setNotice(`${label}: applied on disk — this host cannot hot-reload links, so it takes effect on the next host start`);
					await refresh();
					return;
				}
				try {
					const entries = await reconcileList(api, until, { onTick: (snapshot) => {
						if (alive.current) setEntries(snapshot);
					} });
					if (!alive.current) return;
					setEntries(entries);
					setListError(null);
				} catch (err) {
					if (!alive.current) return;
					if (err instanceof ReconcileTimeoutError) {
						setEntries(err.entries);
						setListError(null);
						setNotice(`${label}: change not reflected yet — refresh manually shortly`);
						return;
					}
					setNotice(errorText(err));
				}
			}, [api, refresh]);
			/**
			* Track a 202-accepted job: poll to settlement, then reconcile the list.
			* `until` describes what the mutation should make visible. Failed and
			* cancelled jobs only refresh — there is no change to reconcile.
			*/
			const track = (0, react.useCallback)(async (entryName, accepted, until) => {
				try {
					const settled = await pollJob(api, accepted.jobId, {
						intervalMs: 800,
						onTick: (job) => patchJob(job.id, job)
					});
					if (!alive.current) return;
					if (settled.status === "error") {
						const question = jobConfirmationQuestion(settled);
						setNotice(question !== void 0 ? `operation needs confirmation but the panel cannot confirm mid-job: ${question}` : `${entryName}: ${settled.error ?? "operation failed"}`);
						await refresh();
					} else if (settled.status === "cancelled") {
						setNotice(`${entryName}: operation cancelled`);
						await refresh();
					} else {
						await reconcileAfter(entryName, "pending", until);
						const backup = adoptBackupNotice(settled);
						if (backup !== null && alive.current) setNotice(backup);
					}
				} catch (err) {
					if (err instanceof PollTimeoutError) {
						patchJob(err.job.id, err.job, true);
						return;
					}
					setNotice(errorText(err));
				}
			}, [
				api,
				patchJob,
				reconcileAfter,
				refresh
			]);
			const run = (0, react.useCallback)(async (entryName, fn) => {
				setNotice(null);
				try {
					await fn();
				} catch (err) {
					setNotice(errorText(err));
				}
			}, []);
			const onAdd = (ev) => {
				ev.preventDefault();
				const url = addUrl.trim();
				if (url.length === 0) return;
				const name = addName.trim();
				const ref = addRef.trim();
				const subdir = addSubdir.trim();
				run(url, async () => {
					setAddBusy(true);
					try {
						const baseline = new Set(entries.map((e) => e.name));
						const env = await api.add({
							url,
							...name.length > 0 ? { name } : {},
							...ref.length > 0 ? { ref } : {},
							...subdir.length > 0 ? { subdir } : {},
							confirm: true
						});
						setAddUrl("");
						setAddName("");
						setAddRef("");
						setAddSubdir("");
						setAddOptionsOpen(false);
						await track(url, env.data, appearsNewName(baseline));
					} finally {
						setAddBusy(false);
					}
				});
			};
			const onCheckUpdates = () => {
				run("check-updates", async () => {
					setChecking(true);
					try {
						await api.checkUpdates();
						await refresh();
					} finally {
						setChecking(false);
					}
				});
			};
			/** The read-only `/doctor` route: errors, warnings and available updates. */
			const onDoctor = () => {
				run("doctor", async () => {
					setHealthBusy(true);
					try {
						const env = await api.doctor();
						if (alive.current) setHealth(env.data);
					} finally {
						setHealthBusy(false);
					}
				});
			};
			/**
			* Export every managed entry to a zip on the server (channel C). The result
			* is a path, not a download — the notice below shows it as copyable text,
			* and `skipped[]` gets the same warning treatment as the CLI's stderr.
			*/
			const onExport = () => {
				run("export", async () => {
					setExportBusy(true);
					try {
						const r = (await api.export({ all: true })).data;
						const skipped = r.skipped.map((s) => `skipped "${s.name}": ${s.reason}`);
						const line = `exported ${r.entries} entr${r.entries === 1 ? "y" : "ies"}, ${r.files} file${r.files === 1 ? "" : "s"} → ${r.out}`;
						setNotice([line, ...skipped].join("\n"));
					} finally {
						setExportBusy(false);
					}
				});
			};
			/** Picking a different file invalidates the verdict shown for the old one. */
			const onPickPackage = (ev) => {
				setImportFile(ev.target.files?.[0] ?? null);
				setImportPlan(null);
			};
			/**
			* Step 1 — the synchronous preview. `dryRun` touches no nexus state, so it is
			* safe to run on every pick and gives the user the four-state verdict and the
			* candidate roots *before* anything is imported.
			*/
			const onPreviewImport = () => {
				const file = importFile;
				if (file === null) return;
				run("import", async () => {
					setImportBusy(true);
					try {
						const env = await api.importPreview(file);
						if (alive.current) setImportPlan(env.data.plan);
					} finally {
						setImportBusy(false);
					}
				});
			};
			/**
			* Step 2 — the confirmed run. The browser still holds the `File`, so the same
			* bytes are uploaded again rather than parking a server-side upload token;
			* the job then does the cloning and linking.
			*/
			const onImport = () => {
				const file = importFile;
				const plan = importPlan;
				if (file === null || plan === null) return;
				run("import", async () => {
					setImportBusy(true);
					try {
						const env = await api.importPackage(file);
						setImportFile(null);
						setImportPlan(null);
						await track(`package ${file.name}`, env.data, importedAll(plan));
					} finally {
						setImportBusy(false);
					}
				});
			};
			const onAdopt = (entry) => {
				const url = (adoptInputs[entry.name] ?? "").trim();
				if (url.length === 0) {
					setNotice(`enter the repository url for "${entry.name}" first — it is never guessed`);
					return;
				}
				const subdir = (adoptSubdirInputs[entry.name] ?? "").trim();
				run(entry.name, async () => {
					if (await confirmable(async (confirm) => {
						const accepted = await api.adopt({
							name: entry.name,
							url,
							...subdir.length > 0 ? { subdir } : {},
							confirm
						});
						await track(entry.name, accepted.data, stillListed(entry.name));
						return accepted;
					}, ask) !== void 0) {
						setAdoptInputs((prev) => ({
							...prev,
							[entry.name]: ""
						}));
						setAdoptSubdirInputs((prev) => ({
							...prev,
							[entry.name]: ""
						}));
					}
				});
			};
			const onToggle = (entry) => {
				const target = !entry.enabled;
				run(entry.name, async () => {
					const env = await api.toggle(entry.name, target);
					await reconcileAfter(entry.name, env.hotReload, flipsTo(entry.name, target));
				});
			};
			const onUpdate = (entry) => {
				run(entry.name, async () => {
					if (await confirmable(async (confirm) => {
						const accepted = await api.update(entry.name, confirm);
						await track(entry.name, accepted.data, stillListed(entry.name));
						return accepted;
					}, ask) === void 0) return;
				});
			};
			/**
			* Ask, then remove. The question is the server's (`409 confirm-required`), so
			* the wording lives in one place; `RiskConfirmation` is only the surface that
			* asks it, with the server's text as its description.
			*/
			const ask = (0, react.useCallback)(async (question) => {
				return window.confirm(question);
			}, []);
			/** Open the removal overlay; the server's question arrives on the retry. */
			const onRemove = (entry) => {
				setPendingRemoval(entry);
				setRemovalAcknowledged(false);
			};
			/** The overlay's confirm: run the remove with the server's own question. */
			const onConfirmRemoval = () => {
				const entry = pendingRemoval;
				if (entry === null) return;
				setPendingRemoval(null);
				setRemovalAcknowledged(false);
				run(entry.name, async () => {
					const done = await confirmable((confirm) => api.remove(entry.name, confirm), ask);
					if (done === void 0) return;
					await reconcileAfter(entry.name, done.hotReload, goneFrom(entry.name));
				});
			};
			const onSwitchVersion = (entry) => {
				const ref = (refInputs[entry.name] ?? "").trim();
				if (ref.length === 0) {
					setNotice(`enter a branch, tag or commit for "${entry.name}" first`);
					return;
				}
				run(entry.name, async () => {
					if (await confirmable(async (confirm) => {
						const accepted = await api.switchVersion({
							name: entry.name,
							ref,
							confirm
						});
						await track(entry.name, accepted.data, stillListed(entry.name));
						return accepted;
					}, ask) !== void 0) setRefInputs((prev) => ({
						...prev,
						[entry.name]: ""
					}));
				});
			};
			const onCancelJob = (job) => {
				run(job.name, async () => {
					await api.cancelJob(job.id);
				});
			};
			const activeJobs = (0, react.useMemo)(() => jobs.filter((t) => t.job.status === "running" || t.stalled), [jobs]);
			const settledJobs = (0, react.useMemo)(() => jobs.filter((t) => t.job.status !== "running" && !t.stalled).slice(-3).reverse(), [jobs]);
			/** Entries with an available update — the toolbar counter's source. */
			const updateCount = (0, react.useMemo)(() => entries.filter((e) => e.update?.hasUpdate === true).length, [entries]);
			const visibleEntries = (0, react.useMemo)(() => entries.filter((e) => matchesQuery(e, query)), [entries, query]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: panel_module_css_default.lede,
						children: "Manage skill repositories: add by git url, toggle, update, pin versions. Discovery itself stays with the official provider — this panel only manages the clones and their symlinks."
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: panel_module_css_default.notice,
						children: notice
					}),
					listError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						className: panel_module_css_default.error,
						children: ["failed to load skills: ", listError]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobProgress, {
						jobs: activeJobs,
						onCancel: onCancelJob
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: panel_module_css_default.install,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
								className: panel_module_css_default.groupTitle,
								children: "install"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								onSubmit: onAdd,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: panel_module_css_default.formRow,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											type: "text",
											placeholder: "github:owner/repo",
											value: addUrl,
											onChange: (e) => setAddUrl(e.target.value),
											disabled: addBusy,
											"aria-label": "git url"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											type: "submit",
											variant: "primary",
											disabled: addBusy || addUrl.trim().length === 0,
											children: "add"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
										className: panel_module_css_default.optional,
										open: addOptionsOpen,
										onToggle: (e) => setAddOptionsOpen(e.currentTarget.open),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "optional: name / ref / subdir" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: panel_module_css_default.optionalGrid,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: panel_module_css_default.fieldLabel,
													children: ["name", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
														type: "text",
														placeholder: "entry name override (default: subdir leaf or repo slug)",
														value: addName,
														onChange: (e) => setAddName(e.target.value),
														disabled: addBusy
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: panel_module_css_default.fieldLabel,
													children: ["ref", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
														type: "text",
														placeholder: "branch/tag (a #ref in the url wins)",
														value: addRef,
														onChange: (e) => setAddRef(e.target.value),
														disabled: addBusy
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: panel_module_css_default.fieldLabel,
													children: ["subdir", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
														type: "text",
														placeholder: "skills/foo (a repository-relative directory)",
														value: addSubdir,
														onChange: (e) => setAddSubdir(e.target.value),
														disabled: addBusy
													})]
												})
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: panel_module_css_default.hint,
										children: "supports github · gitee · gitlab · gitea · any git remote"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: panel_module_css_default.formRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: panel_module_css_default.fieldLabel,
									children: ["import package", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "file",
										accept: ".zip,application/zip",
										onChange: onPickPackage,
										disabled: importBusy
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									onClick: onPreviewImport,
									disabled: importBusy || importFile === null,
									children: "preview"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: panel_module_css_default.hint,
								children: [
									"nexus package (.zip) produced by ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "export" }),
									" — preview the plan, then confirm"
								]
							})
						]
					}),
					importPlan !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.plan,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: panel_module_css_default.hint,
								children: [
									`package: ${importPlan.source} (${importPlan.format}) · `,
									importPlan.labelled ? `manifest: ${importPlan.entries.length} entry(ies)` : "manifest: none (source unknown)",
									importPlan.peel > 0 ? ` · peeled ${importPlan.peel} wrapper level(s), root: ${importPlan.candidate ?? "."}` : ""
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: panel_module_css_default.planList,
								children: importPlan.entries.map((planned) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: planned.name }),
									" ",
									`${planned.files} file(s), ${planned.skills.length} skill(s) — `,
									describeDecision(planned),
									planned.conflict ? " [already registered]" : "",
									planned.enabled ? "" : " [disabled upstream]"
								] }, planned.name))
							}),
							importPlan.skipped.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: panel_module_css_default.error,
								children: `skipped by the exporting machine: "${s.name}" — ${s.reason}`
							}, s.name)),
							importPlan.manifestOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: panel_module_css_default.error,
								children: "this package lists sources but carries no skill content"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: panel_module_css_default.entryActions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									variant: "primary",
									onClick: onImport,
									disabled: importBusy,
									children: "import"
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.toolbar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.search,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									type: "search",
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, {}),
									placeholder: "filter by name or url…",
									value: query,
									onChange: (e) => setQuery(e.target.value),
									"aria-label": "filter skills"
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
								onClick: () => void refresh(),
								disabled: loading,
								children: loading ? "loading…" : "refresh"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								onClick: onCheckUpdates,
								disabled: checking,
								children: checking ? "checking…" : "check updates"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								onClick: onExport,
								disabled: exportBusy,
								children: exportBusy ? "exporting…" : "export all"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: panel_module_css_default.toolbarSpacer }),
							updateCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: "warning",
								children: `${updateCount} update${updateCount === 1 ? "" : "s"}`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: "neutral",
								children: `${entries.length} skill${entries.length === 1 ? "" : "s"}`
							})
						]
					}),
					entries.length === 0 && !loading && listError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: panel_module_css_default.empty,
						children: "no skills registered yet — add one above."
					}),
					entries.length > 0 && visibleEntries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: panel_module_css_default.empty,
						children: `no skill matches "${query.trim()}".`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: panel_module_css_default.entries,
						children: visibleEntries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryCard, {
							entry,
							refValue: refInputs[entry.name] ?? "",
							onRefChange: (v) => setRefInputs((prev) => ({
								...prev,
								[entry.name]: v
							})),
							adoptValue: adoptInputs[entry.name] ?? "",
							onAdoptChange: (v) => setAdoptInputs((prev) => ({
								...prev,
								[entry.name]: v
							})),
							adoptSubdirValue: adoptSubdirInputs[entry.name] ?? "",
							onAdoptSubdirChange: (v) => setAdoptSubdirInputs((prev) => ({
								...prev,
								[entry.name]: v
							})),
							onToggle,
							onUpdate,
							onRemove,
							onSwitchVersion,
							onAdopt
						}) }, entry.name))
					}),
					settledJobs.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: panel_module_css_default.jobs,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: panel_module_css_default.groupTitle,
							children: "recent operations"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: panel_module_css_default.history,
							children: settledJobs.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
								t.job.kind,
								" · ",
								t.entryName,
								" —",
								" ",
								t.job.status === "done" ? "done" : t.job.status === "cancelled" ? "cancelled" : "failed",
								t.job.error !== void 0 ? ` (${t.job.error})` : ""
							] }, t.job.id))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: panel_module_css_default.health,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.groupTitle,
								children: "health check"
							}),
							health === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.hint,
								children: "not run yet"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: healthSummary(health).state }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: healthSummary(health).text })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: panel_module_css_default.toolbarSpacer }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								size: "sm",
								onClick: onDoctor,
								disabled: healthBusy,
								children: healthBusy ? "checking…" : "run check"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: panel_module_css_default.footer,
						children: "This panel manages the skills Nexus installed. To see every local skill (including the ones other tools manage), use Skill Manager."
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.RiskConfirmation, {
						open: pendingRemoval !== null,
						title: "remove skill",
						description: pendingRemoval === null ? "" : `Remove "${pendingRemoval.name}"? This deletes its symlinks, its clone under repos/, and its manifest entry. The confirm step asks again with the server’s own wording.`,
						acknowledgeLabel: "I understand this deletes the clone",
						cancelLabel: "cancel",
						closeLabel: "close",
						confirmLabel: "remove",
						acknowledged: removalAcknowledged,
						onAcknowledgedChange: setRemovalAcknowledged,
						onCancel: () => {
							setPendingRemoval(null);
							setRemovalAcknowledged(false);
						},
						onConfirm: onConfirmRemoval
					})
				]
			});
		}
		/**
		* One entry row. Exported for `test/panel-render.test.ts`: the row is where
		* `hasGitSource` decides which actions exist (update/switch vs attach source)
		* and where `ownership: 'external'` decides what the meta column says, and both
		* are pure props → markup, so they can be rendered and asserted without a DOM,
		* a click, or a mounted effect.
		*
		* The `pin` disclosure is local state: only one row is ever expanded, and
		* `DisclosureRow` keeps the header/chevron behaviour consistent with the host's
		* own panels.
		*/
		function EntryCard({ entry, refValue, onRefChange, adoptValue, onAdoptChange, adoptSubdirValue, onAdoptSubdirChange, onToggle, onUpdate, onRemove, onSwitchVersion, onAdopt }) {
			const canUpdate = entry.hasGitSource;
			const external = entry.ownership === "external";
			const update = entry.update;
			const [pinOpen, setPinOpen] = (0, react.useState)(false);
			const tags = [];
			if (external) tags.push({
				tone: "quiet",
				text: "linked directory"
			});
			else if (!canUpdate) tags.push({
				tone: "quiet",
				text: "no source"
			});
			if (!entry.enabled) tags.push({
				tone: "outline",
				text: "disabled"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: panel_module_css_default.entryRow,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.entryHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: entryState(entry) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.entryName,
								children: entry.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
								className: `${panel_module_css_default.entryMeta} ${panel_module_css_default.mono}`,
								children: `${entry.url} · ${entry.ref || "—"}${entry.commit !== null ? ` · ${shortSha(entry.commit)}` : ""}${entry.subdir !== null ? ` · ${entry.subdir}` : ""}`
							}),
							tags.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
								tone: t.tone,
								children: t.text
							}, t.text)),
							update !== null && update.hasUpdate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: panel_module_css_default.updateArrow,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									tone: "warning",
									children: `update available → ${shortSha(update.latestCommit)}`
								})
							})
						]
					}),
					entry.links.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: panel_module_css_default.links,
						children: entry.links.map((l) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: l.enabled ? void 0 : panel_module_css_default.linkOff,
							children: [
								l.enabled ? "✓" : "✕",
								" ",
								l.linkName,
								l.skillName !== l.linkName ? ` (${l.skillName})` : ""
							]
						}, l.linkName))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.entryActions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
								checked: entry.enabled,
								onChange: () => onToggle(entry),
								label: entry.enabled ? `disable ${entry.name}` : `enable ${entry.name}`
							}),
							canUpdate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								size: "sm",
								onClick: () => onUpdate(entry),
								icon: update?.hasUpdate === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}) : void 0,
								children: "update"
							}),
							!canUpdate && !external && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: panel_module_css_default.fieldLabel,
									children: ["attach source", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										type: "text",
										placeholder: "github:owner/repo",
										value: adoptValue,
										onChange: (e) => onAdoptChange(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: panel_module_css_default.fieldLabel,
									children: ["subdir", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										type: "text",
										placeholder: "optional, e.g. skills/foo",
										value: adoptSubdirValue,
										onChange: (e) => onAdoptSubdirChange(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									size: "sm",
									variant: "primary",
									onClick: () => onAdopt(entry),
									disabled: adoptValue.trim().length === 0,
									children: "adopt"
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								size: "sm",
								variant: "outline",
								onClick: () => onRemove(entry),
								children: "remove"
							})
						]
					}),
					canUpdate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinOutlineRegular, {}),
						title: pinOpen ? "pin — close" : "pin to another version",
						open: pinOpen,
						expandable: true,
						onToggle: () => setPinOpen((v) => !v),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: panel_module_css_default.pinRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: panel_module_css_default.pinInput,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										type: "text",
										placeholder: "branch / tag / commit",
										value: refValue,
										onChange: (e) => onRefChange(e.target.value),
										"aria-label": `pin ${entry.name} to a branch, tag or commit`
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									size: "sm",
									onClick: () => onSwitchVersion(entry),
									disabled: refValue.trim().length === 0,
									children: "switch"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									size: "sm",
									onClick: () => setPinOpen(false),
									children: "cancel"
								})
							]
						})
					}),
					external && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
						className: panel_module_css_default.hint,
						children: "remove only deletes the link and the manifest entry — the directory it points at is yours and stays where it is."
					})
				]
			});
		}
		/** Labels the terminal surface needs; this panel ships English only. */
		const TERMINAL_LABELS = {
			signal: (signal) => `signal ${signal}`,
			exitCode: (code) => `exit ${code}`,
			noExitCode: "no exit code",
			running: "running",
			failed: "failed",
			done: "done",
			copy: "copy",
			copied: "copied",
			noOutput: "(no output yet)",
			collapseAria: "collapse output",
			collapse: "collapse",
			expandAria: (hidden) => `expand ${hidden} more line(s)`,
			expand: (hidden) => `expand ${hidden} more line(s)`
		};
		function JobProgress({ jobs, onCancel }) {
			if (jobs.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: panel_module_css_default.jobs,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: panel_module_css_default.groupTitle,
					children: "running operations"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: panel_module_css_default.entries,
					children: jobs.map(({ job, entryName, stalled }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: panel_module_css_default.entryRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: panel_module_css_default.jobHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: job.status === "running" ? "ongoing" : "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									entryName,
									" · ",
									job.kind,
									job.stage !== void 0 ? ` — ${job.stage}` : "",
									job.detail !== void 0 ? ` (${job.detail})` : "",
									stalled ? " — still running, polling gave up (check back later)" : ""
								] })]
							}),
							job.output.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
								command: `${job.kind} ${entryName}`,
								output: job.output.join(""),
								running: job.status === "running",
								maxLines: 6,
								runStateDot: false,
								labels: TERMINAL_LABELS
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: panel_module_css_default.entryActions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									size: "sm",
									onClick: () => onCancel(job),
									disabled: job.status !== "running",
									children: "cancel"
								})
							})
						]
					}, job.id))
				})]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** Client-side loader diagnostics read this name. */
		const name = "dsh-skills-nexus-client";
		/**
		* Services this half reaches through `ctx.<name>`.
		*
		* These are cordis *service* names, not package names: `slots` is registered
		* by the ui-slots package. Cordis refuses an undeclared property access —
		* `ctx.slots` without this list fails the whole loader entry with "cannot get
		* property slots without inject", which blanks the settings dialog rather
		* than degrading. (The package-name list in `dsh.client.inject` is a
		* different layer: the host's boot-graph ordering, not the runtime inject.)
		*/
		const inject = ["slots"];
		/** The settings page — the panel talks to `/skills-nexus/*` same-origin. */
		function SettingsSection() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NexusPanel, {});
		}
		/**
		* Register the settings page.
		* @param ctx - client context carrying the slots service.
		*/
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skills-nexus",
				order: 300,
				label: () => "Skills Nexus"
			}, SettingsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map