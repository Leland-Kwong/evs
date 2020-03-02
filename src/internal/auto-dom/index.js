import isPlainObject from 'is-plain-object';
import { init as snabbdomInit } from 'snabbdom';
import snabbdomProps from './snabbdom-modules/props';
import { elementTypes } from '../element-types';
import {
  isVnode, createVnode, ignoredValues, primitiveTypes,
} from './vnode';
import { isArray, isFunc,
  identity,
  isDef } from '../utils';

const patch = snabbdomInit([
  snabbdomProps,
]);

const prepareArgs = (
  lisp = [],
  callback = identity,
  path = [0],
) => {
  // skip first value since it is the lisp function
  const startFrom = 1;
  const { length } = lisp;
  let i = startFrom;
  // mutated in while loop
  const args = new Array(length - startFrom);

  while (i < length) {
    const itemIndex = i - startFrom;
    const value = callback(lisp[i], [...path, itemIndex]);
    const currentIndex = i - startFrom;

    args[currentIndex] = value;
    i += 1;
  }

  return args;
};

/**
 * @param {Array|arguments} value
 * @param {Function} argProcessor
 * @returns props object
 */
const parseProps = (value = [], argProcessor, path) => {
  const args = prepareArgs(value, argProcessor, path);
  const firstArg = args[0];
  const hasProps = isPlainObject(firstArg)
    && !isVnode(firstArg);
  const props = hasProps
    // remove the first argument
    ? args.shift() : {};
  const { children: childrenFromProps } = props;
  const children = args;
  const combinedChildren = childrenFromProps
    ? [...childrenFromProps, ...children]
    : children;

  /**
   * we can validate/sanitize the props
   */
  // don't mutate the original
  return { ...props,
           /**
            * @important
            * This is necessary for stateful components
            * to use as a key for external data sources.
            */
           $$refId: path.join('.'),
           children: combinedChildren };
};

/**
 * Converts a tree path into array form, so
 * if we received something like:
 *
 * `'uuid.1.2.5.0'` it would become an array
 * `['uuid', 1, 2, 5, 0]`
 *
 * @param {String | Array} value
 * @returns {Array}
 */
const parsePath = (value) => {
  if (isArray(value)) {
    return value;
  }
  // transforms the id back into the original path
  return value.split('.').map((v) => {
    const maybeNum = Number(v);
    return !Number.isNaN(maybeNum) ? maybeNum : v;
  });
};

const getLispFunc = (lisp) =>
  lisp[0];

/**
 * Recursively processes a tree of Arrays
 * as lisp data structures.
 */
const processLisp = (value, nodePath) => {
  const pathArray = parsePath(nodePath);
  const isList = isArray(value);
  /**
   * lisp structure is:
   * [function, ...args]
   */
  const isLispLike = isList
    && isFunc(value[0]);

  if (!isLispLike) {
    if (isList) {
      return value.map((v, i) =>
        processLisp(v, [...pathArray, i]));
    }

    return value;
  }

  const f = getLispFunc(value);
  const argProcessor = f.isVnodeFactory
    // eagerly evaluate for vnodes
    ? processLisp
    : identity;
  const props = parseProps(value, argProcessor, pathArray);
  const nextValue = f(props, pathArray);
  const key = value.$$keyPassthrough || props.key;

  if (isDef(key) && !ignoredValues.has(nextValue)) {
    if (isVnode(nextValue)) {
      nextValue.key = key;
    // pass key through to next component function
    } else {
      nextValue.$$keyPassthrough = key;
    }
  }

  return processLisp(nextValue, pathArray);
};

/**
 * @param {Array} value atomic ui component
 * @param {String | Number} rootId id prefix for component tree
 * @returns vnode
 */
const createElement = (value, rootId) => {
  if (isVnode(value)) {
    return value;
  }

  if (!isDef(rootId)) {
    throw new Error(
      '[createElement] `rootId` must be provided',
    );
  }

  const id = isArray(rootId) ? rootId : [rootId];
  return processLisp(value, id);
};

/**
 * Generates a convenience method for element factories.
 *
 * ```js
 * const div = defineElement('div')
 * const span = defineElement('span')
 *
 * const MyComponent = () =>
 *  ([div,
 *    [span, 1, 2, 3]])
 * ```
 */
const defineElement = (tagName) => {
  function elementFactory(props, refId) {
    return createVnode(tagName, props, refId);
  }

  const defineProps = Object.defineProperties;
  return defineProps(elementFactory, {
    name: {
      value: tagName,
    },
    isVnodeFactory: {
      value: true,
    },
  });
};

const nativeElements = Object.keys(elementTypes)
  .reduce((elementFactories, tagName) => {
    const e = elementFactories;

    e[tagName] = defineElement(tagName);

    return e;
  }, {});

// the `!` symbol is a comment in snabbdom
nativeElements.comment = defineElement('!');

/*
 * TODO:
 * Add support for rendering an array of vnodes
 * so we don't require a single parent vnode.
 */
const renderToDomNode = (domNode, component) => {
  const oldVnode = isVnode(domNode)
    ? domNode
    : domNode.oldVnode;
  const fromNode = oldVnode || domNode;
  const rootId = oldVnode
    ? oldVnode.props.$$refId
    : Math.random().toString(32).slice(2, 7);
  const toNode = createElement(component, rootId);

  patch(fromNode, toNode);
  toNode.elm.oldVnode = toNode;
};

/**
 * Clone and return a new vnode. New children will
 * replace existing children.
 */
const cloneElement = (...args) => {
  const [element, config, children = []] = args;
  const value = createElement(
    element,
    element.props.$$refId,
  );

  if (ignoredValues.has(value)) {
    return value;
  }

  if (primitiveTypes.has(typeof value)) {
    return value;
  }

  /*
   * TODO:
   * Need to figure out an idiomatic way to also
   * combine the hooks
   */
  const { sel } = value;
  const props = config
    ? { ...value.props,
        ...config }
    : value.props;
  const childrenLength = args.length - 2;

  if (childrenLength === 1) {
    props.children = children;
  } else if (childrenLength > 1) {
    const childArray = Array(childrenLength);
    for (let i = 0; i < childrenLength; i += 1) {
      childArray[i] = args[i + 2];
    }
    props.children = childArray;
  }

  return createVnode(sel, props);
};

export {
  defineElement,
  nativeElements,
  renderToDomNode,
  createElement,
  cloneElement,
};

export { getDomNode } from './vnode';
