import { it, describe } from "vitest";
import { format as _format } from "prettier";
import { transform } from "@babel/core";
import preactSignalsUtilsBabel, {
  BabelMacroPluginOptions,
  SyntaxErrorWithLoc,
} from "../babel";

const format = (code: string) => _format(code, { parser: "acorn" });

type TestCase = {
  type: "success" | "error";
  name: string;
  input: string;
  isCJS: boolean;
  options: BabelMacroPluginOptions | undefined;
};
const TestCase = {
  makeSuccess: (name: string, input: string): TestCase =>
    TestCase.makeConfigurable(name, input, {}),
  makeConfigurable: (
    name: string,
    input: string,
    params: Partial<Omit<TestCase, "input" | "output" | "name">>
  ): TestCase => ({
    type: params.type ?? "success",
    name,
    input,
    isCJS: params.isCJS ?? false,
    options: params.options ?? {
      experimental_stateMacros: true,
    },
  }),
  makeError: (name: string, input: string): TestCase =>
    TestCase.makeConfigurable(name, input, { type: "error" }),
};

describe.concurrent("@preact-signals/utils/macro", () => {
  const success = [
    TestCase.makeSuccess(
      "ESM import",
      `
      import { $$ } from "@preact-signals/utils/macro";

      const a = $$(1)
    `
    ),
    TestCase.makeSuccess(
      "Working inside of scopes",
      `
      import { $$ } from "@preact-signals/utils/macro";

      $$(10)
      {
        const a = $$(1)
        
        const $$ = 0
        
        console.log($$)
      }
      `
    ),
    TestCase.makeSuccess(
      "Transforms only resolved as macro: unresolved",
      `$$(10)`
    ),
    TestCase.makeSuccess(
      "Must remove import event if not used",
      `
      import { $$ } from "@preact-signals/utils/macro";
      `
    ),
    TestCase.makeSuccess(
      "Transforms only resolved as macro: declared",
      `
      import {$$} from "@preact-signals/utils/macro";
      $$(10)
      {
        const $$ = () => 10;
        $$(10)
      }
      `
    ),
    TestCase.makeSuccess(
      "Correctly handles braces in arrow function if using object",
      `
      import { $$ } from "@preact-signals/utils/macro";

      const a = $$({ a: 1 })
    `
    ),
    TestCase.makeConfigurable(
      "CJS import",
      `
      const { $$ } = require("@preact-signals/utils/macro");

      const a = $$(1)
      `,
      { isCJS: true }
    ),
    TestCase.makeConfigurable(
      "CJS import with multiple imports",
      `
      const { $$, $useState } = require("@preact-signals/utils/macro");
      $$(10)
      `,
      {
        isCJS: true,
        options: {
          experimental_stateMacros: false,
        },
      }
    ),
    TestCase.makeSuccess(
      "nested macro",
      `
      const {$$} = require("@preact-signals/utils/macro");

      $$($$(1))
      `
    ),
    TestCase.makeSuccess(
      "is not breaking directives",
      `
        'use client';
        'use strict';
        
        import { $$ } from "@preact-signals/utils/macro";

        const a = $$(1)
      `
    ),
    TestCase.makeSuccess(
      "is not break other imports",
      `
        import React from 'react';
        import {readFileSync} from 'fs';
        import * as path from 'path';
      `
    ),
    TestCase.makeConfigurable(
      "is not break other imports (CJS)",
      `
        const React = require('react');
        const {readFileSync} = require('fs');
        const path = require('path');
      `,
      { isCJS: true }
    ),
    TestCase.makeSuccess(
      "Replaces $useState references",
      `
      import { $useState, $useLinkedState } from "@preact-signals/utils/macro";
      const _ = () => {
        let a = $useState(0)
        let b = $useState(0)
        const c = $useLinkedState(0)
        a += 10
        a.value += 10
        a
        a.value
        
        b += 10
        c.value += 10
      }
      `
    ),
    TestCase.makeSuccess(
      "Correctly work with references in object shorthand",
      `
      import { $useState } from "@preact-signals/utils/macro";

      const _ = () => {
        let a = $useState(0)
        let b = $useState(0)
        const c = $useState(0)
        return { a, b, c }
      }
      `
    ),
    TestCase.makeSuccess(
      "Top level macro works",
      `
      import { $state } from "@preact-signals/utils/macro";

      let a = $state(0)

      effect(() => {
        console.log(a)
      })
      a += 10
      `
    ),
    TestCase.makeSuccess(
      "$derived transforms correctly",
      `
      import { $derived } from '@preact-signals/utils/macro'
      
      const state = $derived(10)
      `
    ),
    TestCase.makeSuccess(
      "$useDerived transforms correctly",
      `
      import { $useDerived } from '@preact-signals/utils/macro'

      const _ = () => {
        const state = $useDerived(10)
      }
      `
    ),
  ];

  for (const { input, isCJS, name, options } of success) {
    it(name, async ({ expect }) => {
      expect(
        await format(
          transform(input, {
            plugins: [[preactSignalsUtilsBabel, options]],
            sourceType: isCJS ? "script" : "module",
          })?.code!
        )
      ).toMatchSnapshot();
    });
  }
  const fail = [
    TestCase.makeError(
      "Throws error if not a CallExpression",
      `
      import { $$ } from "@preact-signals/utils/macro";

      const a = $$;
    `
    ),
    TestCase.makeError(
      "Throws error if callExpression called with multiple arguments",
      `
      import { $$ } from "@preact-signals/utils/macro";

      const a = $$(1, 2);
    `
    ),
    TestCase.makeError(
      "Throws error if callExpression called with no arguments",
      `
      import { $$ } from "@preact-signals/utils/macro";

      const a = $$();
    `
    ),
    TestCase.makeError(
      "Throws error if used with spread argument",
      `
      import { $$ } from "@preact-signals/utils/macro";

      const a = $$(...[1]);
    `
    ),
    TestCase.makeError(
      "Throws error if `$useState` used with var for variable declaration",
      `
      import { $useState } from "@preact-signals/utils/macro";
      const _ = () => {
        var a = $useState(0)
      }
      `
    ),
    TestCase.makeError(
      "Throws error if using $useState outside of function",
      `
      import { $useState } from "@preact-signals/utils/macro";
      let a = $useState(0)
      `
    ),
    TestCase.makeConfigurable(
      "CJS cannot rest pattern in require",
      `
      const { $$, ...a } = require("@preact-signals/utils/macro");`,
      { isCJS: true }
    ),
    TestCase.makeError(
      "Throws error if $linkedState assigned to a variable",
      `
      import { $useLinkedState } from "@preact-signals/utils/macro";
      const _ = () => {
        let a = $useLinkedState(0)
        a += 10
      }
      `
    ),
    // TODO: throw even has no import of known macro
    TestCase.makeError(
      "Throws if imports unknown macro",
      `
      import { $unknown, $$ } from "@preact-signals/utils/macro";
      `
    ),
    // TODO: throw even has no import of known macro
    TestCase.makeError(
      "Throws if imports unknown macro (CJS)",
      `
      const { $unknown, $$ } = require("@preact-signals/utils/macro")
      `
    ),
    TestCase.makeError(
      "Throws if state macros is used outside of variable declaration ($useState)",
      `
      import { $useState } from "@preact-signals/utils/macro";
      const _ = () => {
        $useState(0)
      }`
    ),
    TestCase.makeError(
      "Throws if state macros is used outside of variable declaration ($useLinkedState)",
      `
      import { $useLinkedState, $useState } from "@preact-signals/utils/macro";
      const _ = () => {
        let a = $useState(0)
        $useLinkedState(0)
      }`
    ),
    TestCase.makeError(
      "Throws if state macros uses let for linked state",
      `
      import { $useLinkedState } from "@preact-signals/utils/macro";
      const _ = () => {
        let a = $useLinkedState(0)
      }`
    ),
    TestCase.makeError(
      "Throws if top level macro exported from module (inline export)",
      `
      import { $state } from "@preact-signals/utils/macro";

      export let a = $state(0)
      `
    ),
    TestCase.makeError(
      "Throws if top level macro exported from module (statement export)",
      `
      const { $state } = require("@preact-signals/utils/macro");

      let a = $state(0)

      export { a }
      `
    ),
    TestCase.makeError(
      "Throws if linked state assigned",
      `
      import {$useLinkedState} from '@preact-signals/utils/macro'
      
      const _ = () => {
        const a = $useLinkedState(10)
        
        a += 20
        a = 20
      }
    `
    ),
    ...["$derived", "$useDerived"].map((it) =>
      TestCase.makeError(
        `Throws if ${it} state is ressigned`,
        `
      import {${it}} from '@preact-signals/utils/macro'
      
      const _ = () => {
        const a = ${it}(10)
        
        a += 20
        a = 20
      }
      `
      )
    ),
    TestCase.makeError(
      "Throws if state is reassigned",
      `
      import { $state } from "@preact-signals/utils/macro";

      const a = $state(0)
      a = 10
      `
    ),
  ];

  for (const { input, isCJS, name, options } of fail) {
    it(name, async ({ expect }) => {
      expect(() => {
        try {
          transform(input, {
            plugins: [[preactSignalsUtilsBabel, options]],
            sourceType: isCJS ? "script" : "module",
          });
        } catch (e) {
          // console.log(e);
          throw e;
        }
        // @ts-expect-error private constructor is a shit show
      }).toThrowError(SyntaxErrorWithLoc);
    });
  }
});
