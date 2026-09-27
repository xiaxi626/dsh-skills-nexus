window.__ModuleLoader__.load({
	id: "dsh-skills-nexus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/** The probe page — proves the section renders inside the real Settings shell. */
		function ProbeSection() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "dsh-skills-nexus — client half loaded (Phase 0 probe)." });
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
			}, ProbeSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map