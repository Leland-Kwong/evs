import isPlainObject from 'is-plain-object';
import { init as snabbdomInit } from 'snabbdom';
import snabbdomProps from './snabbdom-modules/props';
import { elementTypes } from '../element-types';
import {
  createVnode,
  createTextVnode,
  primitiveTypes,
  ignoredValues,
  validateVnodeValue,
  setTreeValue,
  hasTreeValue,
  getTreeValue,
  onVtreeCompleted,
} from './vnode';
import { string } from '../string';
import {
  isArray,
  isFunc,
  isDef,
  stringifyValueForLogging,
  identity,
  alwaysTrue,
} from '../utils';
import {
  emptyArr,
  pathSeparator,
  noCurrentConfig,
  specialProps,
} from '../constants';
import * as valueTypes from './value-types';
import {
  getCurrentConfig,
  setCurrentConfig,
  setCurrentDispatcher,
} from './render-context';

const { isType } = valueTypes;

const vnodeKeyTypes = {
  string: true,
  number: true,
};

const newPath = Symbol('newPath');

const keyRegex = /^[a-zA-Z0-9-_/]*$/;

const validateKey = (key, keyType = 'key') => {
  if (process.env.NODE_ENV !== 'development') {
    return key;
  }

  if (isDef(key)) {
    if (!vnodeKeyTypes[typeof key]) {
      throw new Error(string([
        `${keyType} may only be a string or number. `,
        `Received: ${stringifyValueForLogging(key)}`,
      ]));
    } else if (!keyRegex.test(key)) {
      throw new Error(string([
        `${keyType} must satisfy this pattern: ${keyRegex}. `,
        `Received: \`${stringifyValueForLogging(key)}\``,
      ]));
    }
  }

  return key;
};

const patch = snabbdomInit([
  snabbdomProps,
]);

const addToRefId = (currentPath, location) => {
  if (currentPath === newPath) {
    return location;
  }

  return `${currentPath}${pathSeparator}${location}`;
};

/**
 * Makes a new list of arguments. This also
 * gives us the safety to mutate it later without
 * interfering with the original lisp structure.
 * @returns {Array}
 */
const prepareArgs = (
  lisp = emptyArr,
  callback,
  path,
  prevCtor,
  onPathValue,
  skip = 0,
) => {
  const { length } = lisp;
  const argsLength = Math.max(0, length - skip);
  // mutated in while loop
  const args = Array(argsLength);
  let i = 0;

  while (i < args.length) {
    const argIndex = i + skip;
    const arg = lisp[argIndex];
    const evaluated = callback(arg, path, i, prevCtor, onPathValue);

    args[i] = evaluated;
    i += 1;
  }

  return args;
};

const emptyProps = Object.freeze(
  Object.create({}, {
    $$empty: {
      value: true,
    },
  }),
);

/**
 * Mutates the source by applying transformations
 * and remapping as necessary
 */
const applyProps = (
  configProps, props,
) => {
  const keys = Object.keys(props || emptyProps);

  let i = 0;
  while (i < keys.length) {
    const k = keys[i];
    const v = props[k];

    if (!specialProps[k]) {
      // transfer props onto config props
      const p = configProps;
      p[k] = v;
    }

    i += 1;
  }

  return configProps;
};

const getPropsFromArgs = (value) => {
  const firstArg = value[1];
  const hasProps = isPlainObject(firstArg)
    && !isType(firstArg, valueTypes.vnode);

  return hasProps ? firstArg : emptyProps;
};

/**
 * @param {Array|arguments} value
 * @param {Function} argProcessor
 * @returns {Object} props object
 */
const parseProps = (
  value = [], argProcessor, path,
  prevKey, ctor, onPathValue,
) => {
  const props = getPropsFromArgs(value);

  /**
   * validate the original key since
   * we default to `prevKey` after
   */
  validateKey(props.key);

  const { key = prevKey } = props;
  const {
    [specialProps.$$previousRefId]: previousRefId,
  } = props;
  const refId = isDef(previousRefId)
    ? previousRefId
    : addToRefId(path, key);
  const skipValues = !props.$$empty ? 2 : 1;
  const args = prepareArgs(
    value, argProcessor, refId,
    ctor, onPathValue, skipValues,
  );
  const config = {
    props: applyProps({
      [specialProps.$$refId]: refId,
      children: args,
    }, props),
    key: refId,
    ctor,
  };
  const currentConfig = getCurrentConfig(refId);
  const hasConfig = currentConfig !== noCurrentConfig;
  const { props: oProps } = currentConfig;
  const { shouldUpdate = alwaysTrue } = props;

  if (hasConfig
      && !shouldUpdate(oProps, config.props)) {
    return currentConfig;
  }

  return config;
};

const getLispFunc = (lisp) =>
  lisp[0];

/**
 * Recursively processes a tree of Arrays
 * as lisp data structures.
 *
 * @param {any} value
 * @param {String} path
 * @param {String | Number} prevKey The key prop
 * that transferred through from a previous functional
 * component call.
 * @returns {Any} evaluated value
 */
const processLisp = (
  value, path, prevKey,
  prevCtor, onPathValue,
) => {
  const $type = typeof value;

  if (primitiveTypes.has($type)) {
    return createTextVnode(value);
  }

  if (ignoredValues.has(value)) {
    return createVnode('!',
      { props: emptyProps,
        children: String(value) });
  }

  const isList = isArray(value);
  /**
   * lisp structure is:
   * [function, ...args]
   */
  const isLispLike = isList
    && isFunc(value[0]);

  if (!isLispLike) {
    if (isList) {
      /**
       * @important
       * we add to the refId here to ensure that
       * collections are considered one level deeper
       */
      const nextPath = addToRefId(path, '@item');
      return value.map((v, defaultKey) => {
        /**
         * @important
         * We use the index as a default key so when
         * siblings are shuffled, form controls can
         * still maintain their focus.
         */
        const result = processLisp(
          v, nextPath, defaultKey,
          prevCtor, onPathValue,
        );
        return result;
      });
    }

    validateVnodeValue(value);
    return value;
  }

  if (process.env.NODE_ENV === 'development') {
    const v = value;
    // add type annotation for dev purposes
    v.type = valueTypes.fnComponent;
  }

  const f = getLispFunc(value);
  const isVnodeFn = isType(
    f, valueTypes.domComponent,
  );
  const nextCtor = f;
  const argProcessor = isVnodeFn
    // only eagerly process vnode functions
    ? processLisp : identity;
  const config = parseProps(
    value, argProcessor, path,
    prevKey, nextCtor, onPathValue,
  );
  const fInput = isVnodeFn ? config : config.props;
  const {
    props: { [specialProps.$$refId]: $$refId },
  } = config;
  const currentConfig = getCurrentConfig($$refId);
  const isMemoized = currentConfig === config;

  if (isMemoized) {
    return getTreeValue($$refId);
  }

  /**
     * @important
     * this must be called before executing the
     * dispatcher, so the code inside the dispatcher
     * gets the right information.
     */
  setCurrentConfig($$refId, config);
  setCurrentDispatcher($$refId, f);

  const nextValue = f(fInput);
  const finalValue = processLisp(
    nextValue,
    $$refId,
    '@fn',
    nextCtor,
    onPathValue,
  );

  onPathValue($$refId, finalValue, config);
  return finalValue;
};

const validateSeedPath = (seedPath) => {
  const isPreExistingPath = hasTreeValue(seedPath);

  if (isPreExistingPath) {
    return;
  }

  if (!vnodeKeyTypes[typeof seedPath]) {
    throw new Error(string([
      '[createElement] `seedPath` must be one of types: ',
      `[${Object.keys(vnodeKeyTypes)}]`,
    ]));
  }

  validateKey(seedPath, 'seedPath');
};

/**
 * @param {Array} value atomic ui component
 * @param {String | Number} seedPath id prefix
 * @returns vnode
 */
const createElement = (
  value,
  seedPath,
  onPathValue = identity,
) => {
  if (process.env.NODE_ENV === 'development') {
    validateSeedPath(seedPath);
  }

  if (isType(value, valueTypes.vnode)) {
    return value;
  }

  const vtree = processLisp(
    value,
    newPath,
    String(seedPath),
    undefined,
    onPathValue,
  );

  return vtree;
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
  function elementFactory(config) {
    return createVnode(tagName, config);
  }

  const defineProps = Object.defineProperties;
  return defineProps(elementFactory, {
    name: {
      value: tagName,
    },
    type: {
      value: valueTypes.domComponent,
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
 * Add support for rendering a fragment
 * so we don't require a single parent vnode.
 */
const renderWith = (
  fromNode,
  component,
  seedPath,
  onPathValue = setTreeValue,
) => {
  const toNode = createElement(
    component, seedPath, onPathValue,
  );

  onVtreeCompleted();
  return patch(fromNode, toNode);
};

const Fragment = ({ children }) =>
  children;

export {
  defineElement,
  nativeElements,
  renderWith,
  /**
   * TODO
   * Remove this method from the public api since we
   * don't want it to be used directly. This way we
   * can prevent the issue with vnodes being shared
   * between two different components because snabbdom
   * reuses vnodes internally for optimization purposes.
   */
  createElement,
  Fragment,
  valueTypes,
};

export {
  getCurrentConfig,
  getCurrentDispatcher,
} from './render-context';

export { getDomNode } from './vnode';
