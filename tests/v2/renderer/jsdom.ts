import { JSDOM } from "jsdom";

const dom = new JSDOM(
  "<!doctype html><html><body><main id=\"app\"></main></body></html>",
  { url: "http://localhost" },
);

Object.defineProperties(globalThis, {
  window: {
    configurable: true,
    value: dom.window,
  },
  document: {
    configurable: true,
    value: dom.window.document,
  },
  navigator: {
    configurable: true,
    value: dom.window.navigator,
  },
  HTMLElement: {
    configurable: true,
    value: dom.window.HTMLElement,
  },
  SVGElement: {
    configurable: true,
    value: dom.window.SVGElement,
  },
  Node: {
    configurable: true,
    value: dom.window.Node,
  },
  CustomEvent: {
    configurable: true,
    value: dom.window.CustomEvent,
  },
});
