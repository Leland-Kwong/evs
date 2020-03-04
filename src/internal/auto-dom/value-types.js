export const isType = (value, type) =>
  value && value.type === type;

export const vnode = Symbol('@vnode');
export const domComponent = Symbol('@domComponent');
export const fnComponent = Symbol('@fnComponent');