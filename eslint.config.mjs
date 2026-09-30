import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: { parser: tseslint.parser, parserOptions: { project: "./tsconfig.json" } },
	},
	{ ignores: ["main.js", "node_modules/**", "esbuild.config.mjs", "eslint.config.mjs"] },
);
