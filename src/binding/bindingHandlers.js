
export const bindingHandlers = Object.create(null);

// Use an overridable method for retrieving binding handlers so that plugins may support dynamically created handlers
export let getBindingHandler = bindingKey => bindingHandlers[bindingKey];

export const _overrideGetBindingHandler = (fn) => getBindingHandler = fn;
