import { addWatch, removeWatch, atom } from 'atomic-state';
import {
  createVnode,
  getTreeValue,
  enqueueHook,
  setTreeValue,
} from './vnode';
import {
  pathSeparator,
  specialProps,
} from '../constants';
import {
  isArray,
  identity,
  isFunc,
  withDefault,
  alwaysTrue,
} from '../utils';
import * as valueTypes from './value-types';
import {
  renderWith,
  createElement,
} from './element';
import {
  getCurrentConfig,
  getCurrentDispatcher,
} from './render-context';

const getPathRoot = (path) => {
  const sepIndex = path.indexOf(pathSeparator);

  return sepIndex === -1
    ? path : path.slice(0, sepIndex);
};

const activeModels = new Map();

const getScopedModels = (path) =>
  activeModels.get(
    getPathRoot(path),
  );

const setupScopedModels = (path) =>
  activeModels.set(
    getPathRoot(path), new Map(),
  );

const findParentVnode = (pathArray) => {
  let pathIndex = pathArray.length;

  while (pathIndex > 0) {
    // walk up path tree until we find the nearest vnode
    const path = pathArray.slice(0, pathIndex)
      .join(pathSeparator);
    const value = getTreeValue(path);
    if (valueTypes.isType(
      value,
      valueTypes.vnode,
    )) {
      return value;
    }
    pathIndex -= 1;
  }

  return 'noParentVnodeFound';
};

const cleanupOnDestroy = (
  type,
  refId,
  { key, shouldCleanup, watcherFn },
) => {
  const scopedModels = getScopedModels(refId);
  const model = scopedModels.get(key);

  switch (type) {
  case 'destroy': {
    const currentWatcher = model.watchersList
      .get(refId);
    const isWatcherReplaced = currentWatcher
      !== watcherFn;

    if (isWatcherReplaced) {
      return;
    }

    removeWatch(model, refId);

    if (shouldCleanup()) {
      scopedModels.delete(key);
    }

    break;
  }
  default:
    break;
  }
};

const updateSourceValue = Object.assign;

/**
 * @important
 * Any vnode that gets updated must also update
 * the original source value, otherwise the rerender
 * of the root will not have latest changes.
 */
const forceUpdate = (refId) => {
  const {
    props: { $$refId, ...rest },
  } = getCurrentConfig(refId);
  const currentProps = {
    ...rest,
    [specialProps.$$previousRefId]: $$refId,
    [specialProps.shouldUpdate]: alwaysTrue,
  };
  const dispatcher = getCurrentDispatcher(refId);
  const pathArray = refId.split(pathSeparator);
  const isVtreeRoot = pathArray.length === 1;
  const currentValue = getTreeValue(refId);
  /**
   * We know its a fragment if the returned value
   * is a collection of vnodes
   */
  const isFragment = isArray(currentValue);

  if (!isFragment) {
    const onPathValue = isVtreeRoot ? setTreeValue : identity;
    const nextValue = renderWith(
      currentValue, [dispatcher, currentProps],
      refId, onPathValue,
    );

    updateSourceValue(currentValue, nextValue);
    return;
  }

  /**
   * Rerender the fragment by rerendering the
   * parent vnode and updating its children
   * using the new fragment.
   */
  const parentVnode = findParentVnode(pathArray);
  const { children: oChildren } = parentVnode.props;
  const nextValue = createElement(
    [dispatcher, currentProps],
    refId,
  );
  /**
   * Update the old fragment with the new value
   */
  const processChildren = (ch) => {
    const isFragmentChild = isArray(ch);
    const isCurrentFragment = isFragmentChild
      && ch[0].refId === currentValue[0].refId;

    if (isCurrentFragment) {
      updateSourceValue(currentValue, nextValue);
      return nextValue;
    }

    return isFragmentChild
      /**
       * recursively handle children for any
       * nested fragments
       */
      ? ch.map(processChildren)
      : ch;
  };
  const newChildren = oChildren
    .map(processChildren);
  const {
    props: { $$refId: parentRefId },
  } = parentVnode;
  /**
   * Create the new parent vnode by copying it and
   * updating the original children props with the
   * new children props.
   */
  const nextParentVnode = createVnode({
    ...parentVnode,
    props: {
      ...parentVnode.props,
      /**
       * @important
       * We must update the props in order to retain
       * a proper historical copy of changes. Otherwise,
       * if we modify the vnode's children directly, then
       * the next render will not be accessing the latest
       * children from the props. In other words, each
       * update should have a new vnode where the props
       * should be the representation of the change and
       * `createVnode` will generate a new vnode based
       * on the props.
       */
      children: newChildren,
    },
  });

  renderWith(
    parentVnode, nextParentVnode,
    parentRefId, identity,
  );
  updateSourceValue(parentVnode, nextParentVnode);
};

const initModel = (initialModel) =>
  atom(
    isFunc(initialModel)
      ? initialModel()
      : initialModel,
  );

const defaultOptions = {
  shouldCleanup: () =>
    true,
};

const useModel = (
  refId,
  key = refId,
  initialModel,
  options = defaultOptions,
) => {
  const im = initialModel;
  const scopedModels = getScopedModels(refId);

  if (!scopedModels) {
    setupScopedModels(refId);
    return useModel(refId, key, im, options);
  }

  const model = scopedModels.get(key)
    || initModel(im);
  const {
    shouldCleanup = defaultOptions.shouldCleanup,
  } = options;
  const update = () =>
    forceUpdate(refId);

  scopedModels.set(key, model);
  addWatch(model, refId, update);
  enqueueHook(refId, cleanupOnDestroy,
    { key, shouldCleanup, watcherFn: update });

  return model;
};

const emptyMap = new Map();

const hasModel = (refId, key) =>
  withDefault(
    getScopedModels(refId),
    emptyMap,
  ).has(key);

const getAllModels = (refId) =>
  getScopedModels(refId);

export {
  useModel,
  hasModel,
  getAllModels,
  forceUpdate,
};
