import {addDisposeCallback, removeDisposeCallback} from '../utils.domNodeDisposal.js';

export class Subscription {

    constructor(target, callback, disposeCallback) {
        this._target = target;
        this._callback = callback;
        this._disposeCallback = disposeCallback;
        this._isDisposed = false;
        this._node = null;
        this._domNodeDisposalCallback = null;
    }

    dispose() {
        if (this._isDisposed) {
            return;
        }
        if (this._domNodeDisposalCallback) {
            removeDisposeCallback(this._node, this._domNodeDisposalCallback);
        }
        this._isDisposed = true;
        this._disposeCallback();
        this._target = this._callback = this._disposeCallback = this._node = this._domNodeDisposalCallback = null;
    }

    disposeWhenNodeIsRemoved(node) {
        this._node = node;
        addDisposeCallback(node, this._domNodeDisposalCallback = this.dispose.bind(this));
    }
}
