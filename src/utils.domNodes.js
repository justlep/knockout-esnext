import {removeNode} from './utils.domNodeDisposal';

export const emptyDomNode = (domNode) => {
    let child;
    while (child = domNode.firstChild) {
        removeNode(child);
    }
};

export const setDomNodeChildren = (domNode, childNodes) => {
    emptyDomNode(domNode);
    if (childNodes) {
        for (let i = 0, j = childNodes.length; i < j; i++) {
            domNode.appendChild(childNodes[i]);
        }
    }
};
