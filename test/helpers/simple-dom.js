// A tiny DOM shim sufficient to exercise MMM-Scores.js's playoff DOM-building
// code under node:test, without a real browser. Not a general-purpose DOM:
// just enough createElement/classList/style/appendChild support to build and
// inspect the tree MMM-Scores.js produces.
'use strict';

function makeClassList(el) {
  return {
    add() {
      for (const c of arguments) {
        if (!el._classes.includes(c)) el._classes.push(c);
      }
    },
    contains(c) { return el._classes.includes(c); }
  };
}

function makeStyle() {
  const store = {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'setProperty') return (name, value) => { store[name] = value; };
      if (prop === 'removeProperty') return (name) => { delete store[name]; };
      if (prop === '_store') return store;
      return store[prop];
    },
    set(target, prop, value) { store[prop] = value; return true; }
  });
}

function createElement(tag) {
  const el = {
    tagName: tag,
    _classes: [],
    children: [],
    attrs: {},
    style: makeStyle(),
    appendChild(child) { el.children.push(child); return child; },
    setAttribute(name, value) { el.attrs[name] = value; },
    getAttribute(name) { return el.attrs[name]; },
    set innerText(v) { this._text = v; },
    get innerText() { return this._text; },
    set src(v) { this._src = v; },
    get src() { return this._src; },
    set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); },
    get className() { return this._classes.join(' '); }
  };
  el.classList = makeClassList(el);
  return el;
}

function createElementNS(_ns, tag) {
  return createElement(tag);
}

function findAll(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

module.exports = { createElement, createElementNS, findAll };
