import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

const root = import.meta.dirname;
const SHERATAN = '/Users/arifdewi/Projects/Dolasoft/sheratan/packages/core/dist/prod/index.js';

const STACKS: Record<string, string> = {
  Sheratan: `
    import { signal, computed, batch, watch, onDispose, html, render, each, resource, stream, flush } from ${JSON.stringify(SHERATAN)};
    export const used = [signal, computed, batch, watch, onDispose, html, render, each, resource, stream, flush];
  `,
  'Solid 1.9': `
    import { createSignal, createMemo, createEffect, batch, onCleanup, createRoot, For, untrack } from 'solid-js';
    import { render, template, insert, effect, setAttribute, delegateEvents } from 'solid-js/web';
    import { QueryClient, createQuery } from '@tanstack/solid-query';
    import { createVirtualizer } from '@tanstack/solid-virtual';
    export const used = [createSignal, createMemo, createEffect, batch, onCleanup, createRoot, For, untrack, render, template, insert, effect, setAttribute, delegateEvents, QueryClient, createQuery, createVirtualizer];
  `,
  'Svelte 5': `
    import App from './app.svelte.js';
    import { mount, unmount, tick } from 'svelte';
    import { QueryClient, createQuery } from '@tanstack/svelte-query';
    import { createVirtualizer } from '@tanstack/svelte-virtual';
    export const used = [App, mount, unmount, tick, QueryClient, createQuery, createVirtualizer];
  `,
  'Vue 3': `
    import { ref, shallowRef, computed, watchEffect, onScopeDispose, effectScope, h, createApp, Fragment, nextTick, reactive } from 'vue';
    import { QueryClient, VueQueryPlugin, useQuery } from '@tanstack/vue-query';
    import { useVirtualizer } from '@tanstack/vue-virtual';
    export const used = [ref, shallowRef, computed, watchEffect, onScopeDispose, effectScope, h, createApp, Fragment, nextTick, reactive, QueryClient, VueQueryPlugin, useQuery, useVirtualizer];
  `,
  'React 19': `
    import { useState, useMemo, useCallback, useEffect, useSyncExternalStore, useRef, useContext, createContext, createElement, Fragment, memo, startTransition } from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
    import { useVirtualizer } from '@tanstack/react-virtual';
    export const used = [useState, useMemo, useCallback, useEffect, useSyncExternalStore, useRef, useContext, createContext, createElement, Fragment, memo, startTransition, createRoot, QueryClient, QueryClientProvider, useQuery, useVirtualizer];
  `,
  'Angular 19': `
    import { signal, computed, effect, Component, Injectable, inject, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
    import { bootstrapApplication } from '@angular/platform-browser';
    import { NgFor, NgIf, AsyncPipe } from '@angular/common';
    import { HttpClient, provideHttpClient } from '@angular/common/http';
    import { ScrollingModule } from '@angular/cdk/scrolling';
    import { retry, timer, Subject, switchMap } from 'rxjs';
    export const used = [signal, computed, effect, Component, Injectable, inject, ChangeDetectionStrategy, DestroyRef, bootstrapApplication, NgFor, NgIf, AsyncPipe, HttpClient, provideHttpClient, ScrollingModule, retry, timer, Subject, switchMap];
  `,
};

async function size(contents: string): Promise<number> {
  const result = await build({
    stdin: { contents, resolveDir: root, loader: 'js' },
    bundle: true, format: 'esm', minify: true, target: 'es2022', platform: 'browser',
    conditions: ['module', 'browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"', ngDevMode: 'false', ngJitMode: 'false' },
    write: false, logLevel: 'silent',
    // Real compilation, so Svelte's row is the runtime a component actually
    // pulls in rather than the whole of svelte/internal/client.
    plugins: [{
      name: 'svelte',
      setup(builder) {
        builder.onLoad({ filter: /\.svelte$/ }, async (args) => ({
          contents: compile(await readFile(args.path, 'utf8'), { generate: 'client', filename: args.path }).js.code,
          loader: 'js',
          resolveDir: args.path.replace(/\/[^/]+$/, ''),
        }));
      },
    }],
  });

  return gzipSync(result.outputFiles[0]!.contents, { level: 9 }).byteLength;
}

const base = await size(STACKS['Sheratan']!);

for (const [label, contents] of Object.entries(STACKS)) {
  const bytes = await size(contents);
  console.log(`${label.padEnd(12)} ${(bytes / 1024).toFixed(1).padStart(6)} kB gzip   ${(bytes / base).toFixed(1)}x`);
}
