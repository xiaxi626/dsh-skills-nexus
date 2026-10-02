window.__ModuleLoader__.load({
	id: "dsh-skills-nexus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/**
		* Build the api object over an injectable transport. The default binds the
		* global `fetch` (the browser half runs same-origin — paths only, no host).
		*/
		function createApi(fetchImpl = (input, init) => fetch(input, init)) {
			return {
				list: () => request(fetchImpl, "/skills-nexus/list"),
				doctor: () => request(fetchImpl, "/skills-nexus/doctor"),
				add: (body) => postJson(fetchImpl, "/skills-nexus/add", body),
				addZip: (file) => {
					const form = new FormData();
					form.append("file", file);
					return request(fetchImpl, "/skills-nexus/add-zip", {
						method: "POST",
						body: form
					});
				},
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
				cancelJob: (id) => postJson(fetchImpl, "/skills-nexus/job/cancel", { id })
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
		//#region src/client/panel.tsx
		/**
		* The Settings panel (§10.4): entry-granularity skill cards, an add form
		* (git url / zip upload), the job progress view (§7.5) and the destructive-
		* action confirm flow (§12.2 — the server's `409 confirm-required` question is
		* the single source of consequence wording; the panel only asks and retries).
		*
		* Styling stays deliberately structural (semantic elements, no stylesheet
		* dependency): the half runs inside the host Settings shell, and hooking the
		* host UI primitives is a later refinement — the contract proven here is the
		* data flow, not the pixels.
		*
		* §11 reconciliation is live: a mutation marked `hotReload: 'pending'` polls
		* the list (2s budget) until the change is visible; `done` refreshes once;
		* `unsupported` — the preserved contract for watcher-less hosts — explains
		* the restart downgrade. `reconcileAfter` is the single funnel for all three.
		*/
		const shortSha = (sha) => sha === null ? "" : sha.slice(0, 7);
		/** Map route errors to one-line user-readable text (codes are the §7.1 contract). */
		function errorText(err) {
			if (err instanceof ApiError) switch (err.error) {
				case "busy": return `"${err.data?.name ?? "skill"}" has another operation in flight — try again shortly`;
				case "locked": return `locked by another process (pid ${err.data?.pid ?? "?"}), likely a CLI command — retry once it exits`;
				case "already-registered": return "a skill with this name is already registered";
				case "collision": return "a file or directory with this name already exists in the skills root";
				case "not-a-git-clone": return "this entry has no git source — remove it and install it again from its repository";
				case "ref-not-found": return "the ref does not exist on the remote";
				case "not-found": return "no such skill — the list may be stale, refresh it";
				case "untrusted origin": return "request blocked: untrusted origin";
				default: return `${err.status} ${err.error}`;
			}
			return err instanceof Error ? err.message : String(err);
		}
		/** add/add-zip: a name outside the pre-mutation baseline appears. */
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
		/**
		* The panel. `api` is injectable for future harness tests; production builds
		* bind the global fetch. The instance MUST be render-stable: a per-render
		* `createApi()` default would change `refresh`'s identity every render,
		* re-fire the list effect, and loop the panel in a self-sustaining fetch
		* storm (observed live as connection-pool exhaustion in the host browser).
		* Lazy useState pins it for the mount's lifetime; the prop stays the
		* test-injection seam.
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
			const [zipFile, setZipFile] = (0, react.useState)(null);
			const [checking, setChecking] = (0, react.useState)(false);
			const [refInputs, setRefInputs] = (0, react.useState)({});
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
			* §11 reconciliation funnel for a mutation. `pending` (or a missing field
			* from an older server): poll the list until `until` accepts a snapshot.
			* `done`: the mutation never woke the watcher — one refresh suffices.
			* `unsupported` (the preserved contract for hosts without a watcher): say
			* plainly that the change lands on the next host start. A timeout downgrades
			* to the manual-refresh hint while the last snapshot stays on screen.
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
			* `until` describes what the mutation should make visible (§11). Failed and
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
					} else await reconcileAfter(entryName, "pending", until);
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
			const ask = (0, react.useCallback)(async (question) => {
				return window.confirm(question);
			}, []);
			const onAdd = (ev) => {
				ev.preventDefault();
				const url = addUrl.trim();
				if (url.length === 0) return;
				run(url, async () => {
					setAddBusy(true);
					try {
						const baseline = new Set(entries.map((e) => e.name));
						const env = await api.add({
							url,
							confirm: true
						});
						setAddUrl("");
						await track(url, env.data, appearsNewName(baseline));
					} finally {
						setAddBusy(false);
					}
				});
			};
			const onAddZip = () => {
				const file = zipFile;
				if (file === null) {
					setNotice("choose a .zip file first");
					return;
				}
				run(file.name, async () => {
					setAddBusy(true);
					try {
						const baseline = new Set(entries.map((e) => e.name));
						const env = await api.addZip(file);
						setZipFile(null);
						await track(file.name, env.data, appearsNewName(baseline));
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
			const onRemove = (entry) => {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skills-nexus-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Manage skill repositories: add by git url or zip upload, toggle, update, pin versions. Discovery itself stays with the official provider — this panel only manages the clones and their symlinks." }),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "skills-nexus-notice",
						children: notice
					}),
					listError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						className: "skills-nexus-error",
						children: ["failed to load skills: ", listError]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobProgress, {
						jobs: activeJobs,
						onCancel: onCancelJob
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						onSubmit: onAdd,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
							"add from git url",
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								placeholder: "github:owner/repo",
								value: addUrl,
								onChange: (e) => setAddUrl(e.target.value),
								disabled: addBusy
							})
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: addBusy || addUrl.trim().length === 0,
							children: "add"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
						"add from zip",
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "file",
							accept: ".zip",
							onChange: (e) => setZipFile(e.target.files?.[0] ?? null)
						})
					] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onAddZip,
						disabled: addBusy || zipFile === null,
						children: "upload"
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => void refresh(),
						disabled: loading,
						children: loading ? "loading…" : "refresh"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onCheckUpdates,
						disabled: checking,
						children: checking ? "checking…" : "check updates"
					})] }),
					entries.length === 0 && !loading && listError === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "no skills registered yet — add one above." }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryCard, {
						entry,
						refValue: refInputs[entry.name] ?? "",
						onRefChange: (v) => setRefInputs((prev) => ({
							...prev,
							[entry.name]: v
						})),
						onToggle,
						onUpdate,
						onRemove,
						onSwitchVersion
					}) }, entry.name)) }),
					settledJobs.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "recent operations" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: settledJobs.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
						t.job.status === "done" ? "✓" : t.job.status === "cancelled" ? "–" : "✕",
						" ",
						t.job.kind,
						" · ",
						t.entryName,
						t.job.error !== void 0 ? ` — ${t.job.error}` : ""
					] }, t.job.id)) })] })
				]
			});
		}
		function EntryCard({ entry, refValue, onRefChange, onToggle, onUpdate, onRemove, onSwitchVersion }) {
			const isZip = entry.source === "zip";
			const update = entry.update;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: entry.name }),
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: isZip ? "zip" : `${entry.url}${entry.subdir !== null ? ` · ${entry.subdir}` : ""}` }),
					" ",
					entry.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "enabled" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "disabled" }),
					update !== null && update.hasUpdate && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: ["update available → ", shortSha(update.latestCommit)] })
				] }),
				entry.links.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: entry.links.map((l) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
					l.enabled ? "✓" : "✕",
					" ",
					l.linkName,
					l.skillName !== l.linkName ? ` (${l.skillName})` : ""
				] }, l.linkName)) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => onToggle(entry),
						children: entry.enabled ? "disable" : "enable"
					}),
					!isZip && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => onUpdate(entry),
							children: "update"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
							"pin to",
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								placeholder: "branch / tag / commit",
								value: refValue,
								onChange: (e) => onRefChange(e.target.value)
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => onSwitchVersion(entry),
							disabled: refValue.trim().length === 0,
							children: "switch"
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => onRemove(entry),
						children: "remove"
					})
				] })
			] });
		}
		function JobProgress({ jobs, onCancel }) {
			if (jobs.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "running operations" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: jobs.map(({ job, entryName, stalled }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					entryName,
					" · ",
					job.kind,
					job.stage !== void 0 ? ` — ${job.stage}` : "",
					job.detail !== void 0 ? ` (${job.detail})` : "",
					stalled ? " — still running, polling gave up (check back later)" : ""
				] }),
				job.output.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: job.output.slice(-6).join("") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => onCancel(job),
					disabled: job.status !== "running",
					children: "cancel"
				})
			] }, job.id)) })] });
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