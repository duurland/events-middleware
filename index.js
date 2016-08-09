'use strict';

const util = require('util');
const _EventEmitter = require('events');

function callable(instance) {
    return function(...args) {
        instance.call.apply(instance, args);
    };
}

function wrapPromise(fn) {
    return function(...args) {
        return new Promise((resolve, reject) => {
            const cb = function(err, ...value) {
                if (err) {
                    return reject(err);
                } else {
                    return resolve(value);
                }
            };
            const promise = fn.apply(this, [...args, cb]);
            if (Promise.resolve(promise) == promise) {
                promise.then((...value) => resolve(value)).catch(reject);
            }
        });
    };
}

class EventMiddleware {
    constructor(eventName, fn, options = {}) {
        this._pres = [];
        this._posts = [];
        this._options = {
            globalArgs: false,
            multiArgs: true
        };
        this._onError = function(err) {
            return Promise.reject(err);
        };

        this.eventName = eventName;
        this._main = wrapPromise(fn);
        this.setOptions(options);
        this._compose();
    }

    _initOptions(options) {
        const getBoolOption = (options, name) => {
            return util.isBoolean(options[name]) ? options[name] : this._options[name];
        };
        return {
            globalArgs: getBoolOption(options, 'globalArgs'),
            multiArgs: getBoolOption(options, 'multiArgs')
        };
    }

    setOptions(options) {
        this._options = this._initOptions(options);
        return this;
    }

    _compose() {
        this._fns = this._pres.concat([this._main]).concat(this._posts);
    }

    catch (callback) {
        this._onError = callback;
        return this;
    }

    _addFns(role, fns) {
        if (!Array.isArray(fns)) {
            fns = [fns];
        }
        fns.forEach(fn => this[role].push(wrapPromise(fn)));
        this._compose();
    }

    pre(fns) {
        this._addFns('_pres', fns);
        return this;
    }

    post(fns) {
        this._addFns('_posts', fns);
        return this;
    }

    call(...value) {
        let idx = 0;
        const len = this._fns.length;
        return new Promise((resolve, reject) => {
            const next = (nextValue) => {
                if (this._options.globalArgs) {
                    nextValue = value;
                }
                if (!this._options.multiArgs) {
                    nextValue = nextValue.slice(0, 1);
                }
                if (idx >= len) {
                    const _value = nextValue.length < 2 ? nextValue[0] : nextValue;
                    return resolve(_value);
                }
                const nextFn = this._fns[idx++];
                nextFn.apply(this, nextValue).then(next).catch(reject);
            };
            next(value);
        }).catch(this._onError);
    }
}

class MiddlewareCollection {
    constructor(options = {}, middlewares) {
        this._middlewares = middlewares || new Map();
        
        this.setOptions(options);
    }
    
    setOptions(options) {
        this._options = options;
    }

    new(eventName, fn, options) {
        if (this._middlewares.has(eventName)) {
            throw Error(`eventName ${eventName} has added`);
        }
        const middleware = new EventMiddleware(eventName, listener,
                                               options || this._options || {});
        this._middlewares.set(eventName, middleware);
        return middleware;
    }
    
    select(eventNames) {
        const middlewares;
        return new MiddlewareCollection(this._options, middlewares);
    }

    onError(callback) {
        this._eachMiddleware('catch', callback);
        return this;
    }

    _eachMiddleware(method, ...args) {
        for (let middleware of this._middlewares.values()) {
            middleware[method](...args);
        }
    }
    
    pre(fns) {
        this._eachMiddleware('pre', fns);
        return this;
    }

    post(fns) {
        this._eachMiddleware('post', fns);
        return this;
    }
    
    has(eventName) {
        return this._middlewares.has(eventName);
    }
}

class EventEmitter extends _EventEmitter {
    constructor(options = {}) {
        super();
        this._middlewares = new MiddlewareCollection();
        this.setOptions(options);
    }

    setOptions(options) {
        this._options = options;
        this._middlewares.setOptions(this._options.middleware);
    }

    middleware(eventName, listener, options) {
        if (!eventName) {
            return this._middlewares;
        }
        if (!listener) {
            return this._middlewares.select(eventName);
        }
        
        const middleware = this._middlewares.new(eventName, listener, options);
        super.on(eventName, callable(middleware));
        return this._middlewares.select(eventName);
    }
}

module.exports = {
    EventMiddleware,
    MiddlewareCollection,
    EventEmitter
};
