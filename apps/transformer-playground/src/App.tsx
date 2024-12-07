import * as Babel from "@babel/standalone";
import { Editor, useMonaco } from "@monaco-editor/react";
import { $$, $state, $useLinkedState } from "@preact-signals/utils/macro";
import {
  computed,
  effect,
  type ReadonlySignal,
  untracked,
  useSignalEffect,
} from "@preact-signals/safe-react";
import { debounce } from "radash";
import signalsTransformPlugin from "@preact-signals/safe-react/babel";
import macroTransformPlugin from "@preact-signals/utils/babel";
import { shikiToMonaco } from "@shikijs/monaco";
import { getHighlighter } from "shiki";
import { reaction, resource } from "@preact-signals/utils";
import {
  decompressFromEncodedURIComponent,
  compressToEncodedURIComponent,
} from "lz-string";
import { toast } from "sonner";
import reactTypes from "../node_modules/@types/react/index.d.ts?raw";
import macroTypes from "../node_modules/@preact-signals/utils/dist/types/lib/macro.d.ts?raw";

const signalsTransformName = "signals-transform";
Babel.registerPlugin(signalsTransformName, signalsTransformPlugin);
const macroTransformName = "macro-transform";
Babel.registerPlugin(macroTransformName, macroTransformPlugin);

const errorToNull = <T,>(fn: () => T): T | null => {
  try {
    return fn();
  } catch (e) {
    console.error(e);
    return null;
  }
};

type TransformerConfig = {
  macro: boolean;
  macroOptimizations: boolean;
  components: boolean;
};
const getStateFromParams = () => {
  const params = new URLSearchParams(location.search);

  const lzCode = params.get("code");
  const transformerConfig = errorToNull(() =>
    JSON.parse(
      decompressFromEncodedURIComponent(params.get("transformerConfig") ?? "")
    )
  ) as TransformerConfig | null;

  return {
    lzCode,
    transformerConfig,
  };
};

const defaults = (() => {
  const params = getStateFromParams();

  const lzCode = params.lzCode;
  return {
    code:
      lzCode && errorToNull(() => decompressFromEncodedURIComponent(lzCode)),
    transformerConfig: params.transformerConfig,
  };
})();

const syncTransformerConfigToUrl = debounce(
  { delay: 300 },
  (config: TransformerConfig) => {
    const url = new URL(location.href);
    const params = url.searchParams;
    params.set(
      "transformerConfig",
      compressToEncodedURIComponent(JSON.stringify(config))
    );
    window.history.replaceState(null, "", url.href);
  }
);

const transformerConfig = $state({
  "Transform components": defaults.transformerConfig?.components ?? false,
  "Transform macros": defaults.transformerConfig?.macro ?? true,
  "Optimize macros": defaults.transformerConfig?.macroOptimizations ?? true,
});

effect(() => {
  syncTransformerConfigToUrl({
    components: transformerConfig["Transform components"],
    macro: transformerConfig["Transform macros"],
    macroOptimizations: transformerConfig["Optimize macros"],
  });
});

const syncCodeToUrl = debounce({ delay: 300 }, (code: string) => {
  const url = new URL(location.href);
  const params = url.searchParams;
  params.set("code", compressToEncodedURIComponent(code));

  window.history.replaceState(null, "", url.href);
});

let text = $state(
  defaults.code ??
    `\
import { $state } from '@preact-signals/utils/macro'

let text = $state('')

function App() {
  return (
    <div>
      <input value={text} onInput={(e) => (text = e.target.value)} />
      <p>{text}</p>
    </div>
  )
}
`
);
effect(() => {
  syncCodeToUrl(text);
});

const setDebouncedText = debounce({ delay: 100 }, (value: string) => {
  text = value;
});

const babelOutput = computed(() => {
  const plugins = [
    transformerConfig["Transform components"] &&
      Babel.availablePlugins[signalsTransformName],
    transformerConfig["Transform macros"] && [
      Babel.availablePlugins[macroTransformName],
      {
        stateMacros: true,
        experimental_stateMacrosOptimization:
          transformerConfig["Optimize macros"],
      },
    ],
  ].filter(Boolean);
  try {
    return {
      isError: false,
      value:
        Babel.transform(text, {
          // presets: [Babel.availablePresets.env],
          // @ts-expect-error filter(Boolean)
          plugins,
          parserOpts: {
            plugins: ["typescript", "jsx"],
          },
        }).code ?? "",
    } as const;
  } catch (e) {
    return {
      isError: true,
      value: e,
    } as const;
  }
});
reaction(
  () =>
    transformerConfig["Optimize macros"] &&
    !transformerConfig["Transform macros"],
  (isIncorrectOptions) => {
    if (isIncorrectOptions) {
      toast.warning(
        "`Optimize macros` option will take any effect only if `Transform macros` used"
      );
    }
  },
  { memoize: true }
);

const highlighter = resource({
  fetcher: async () => {
    const h = await getHighlighter({
      themes: ["github-dark", "github-light"],
      langs: ["typescript"],
    });
    await h.loadTheme("github-light");

    return h;
  },
});

const ErrorDialog = ({
  className,
  error,
}: {
  error: ReadonlySignal<string | null>;
  className?: string;
}) => {
  return (
    <div
      className={[className ?? "", !error.value && "pointer-events-none"].join(
        " "
      )}
    >
      <input
        type="checkbox"
        readOnly
        checked={!!error.value}
        className="modal-toggle"
      />
      <div className="modal absolute">
        <div className="modal-box">
          <p className="py-4">{error}</p>
        </div>
      </div>
    </div>
  );
};

let $prevSuccessCompilation = $state(
  babelOutput.value.isError ? "" : babelOutput.value.value
);
effect(() => {
  if (!babelOutput.value.isError) {
    $prevSuccessCompilation = babelOutput.value.value;
  }
});

function App() {
  const monaco = $useLinkedState(useMonaco());

  useSignalEffect(() => {
    const h = highlighter();
    if (!monaco || !h) {
      return;
    }
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ES2015,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      typeRoots: ["node_modules/@types"],
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      reactTypes,
      `file:///node_modules/@react/types/index.d.ts`
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      export function add(a: number, b: number): number
      `,
      `file:///node_modules/@types/@preact-signals/utils/macro/index.d.ts`
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      export function add(a: number, b: number): number
      `,
      `file:///node_modules/a/types/index.d.ts`
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      export function add(a: number, b: number): number
      `,
      `file:///node_modules/@types/a/index.d.ts`
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      export function add(a: number, b: number): number
      `,
      `@types/a/index.d.ts`
    );

    // h.loadLanguage("typescript");
    monaco.languages.register({ id: "typescript" });

    shikiToMonaco(h, monaco);
  });
  return (
    <div className="max-h-screen h-screen flex flex-col flex-1">
      <div className="flex gap-4 items-center px-4">
        Settings:
        {$$(
          Object.entries(transformerConfig).map(([key, value]) => (
            <label className="label gap-2 cursor-pointer" key={key}>
              <input
                onChange={() => {
                  // @ts-expect-error Object.entries
                  transformerConfig[key] = !value;
                }}
                type="checkbox"
                checked={value}
                className="checkbox"
              />
              <span className="label-text">{key}</span>
            </label>
          ))
        )}
      </div>
      <div className="flex flex-row h-full max-w-full overflow-hidden">
        <Editor
          height={"100%"}
          width={"50%"}
          className="flex-1"
          options={{
            minimap: {
              enabled: false,
            },
            wordWrap: "on",
          }}
          theme="github-dark"
          defaultLanguage="typescript"
          defaultValue={untracked(() => text)}
          onChange={(v) => setDebouncedText(v ?? "")}
        />

        {$$(
          <div className="relative h-full flex-1">
            <Editor
              height={"100%"}
              options={{
                minimap: {
                  enabled: false,
                },
                readOnly: true,
                "semanticHighlighting.enabled": true,
                inlayHints: {
                  enabled: "on",
                },
                wordWrap: "on",
              }}
              language="typescript"
              theme="github-dark"
              value={$prevSuccessCompilation}
            />

            <ErrorDialog
              error={$$(
                babelOutput.value.isError
                  ? String(babelOutput.value.value)
                  : null
              )}
              className="absolute inset-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
