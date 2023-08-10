
// Go through the items that have been added and deleted and try to find matches between them.
export const findMovesInArrayComparison = (left, right, limitFailedCompares) => {
    if (!left.length || !right.length) {
        return;
    }
    let failedCompares = 0, leftItem, rightItem;
    
    for (let l = 0, r;(!limitFailedCompares || failedCompares < limitFailedCompares) && (leftItem = left[l]); ++l) {
        for (r = 0; (rightItem = right[r]); ++r) {
            if (leftItem['value'] === rightItem['value']) {
                leftItem['moved'] = rightItem['index'];
                rightItem['moved'] = leftItem['index'];
                right.splice(r, 1);         // This item is marked as moved; so remove it from right list
                failedCompares = r = 0;     // Reset failed compares count because we're checking for consecutive failures
                break;
            }
        }
        failedCompares += r;
    }
};

// Simple calculation based on Levenshtein distance.
export let compareArrays = (oldArray, newArray, options) => {
    // For backward compatibility, if the third arg is actually a bool, interpret
    // it as the old parameter 'dontLimitMoves'. Newer code should use { dontLimitMoves: true }.
    options = (typeof options === 'boolean') ? {'dontLimitMoves': options} : (options || {});
    oldArray = oldArray || [];
    newArray = newArray || [];

    return (oldArray.length < newArray.length) ?
         compareSmallArrayToBigArray(oldArray, newArray, STATUS_NOT_IN_OLD, STATUS_NOT_IN_NEW, options) :
         compareSmallArrayToBigArray(newArray, oldArray, STATUS_NOT_IN_NEW, STATUS_NOT_IN_OLD, options);
};

// allow overriding compareArrays for tests
export const _overrideCompareArrays = fn => compareArrays = fn;

const STATUS_NOT_IN_OLD = 'added'; 
const STATUS_NOT_IN_NEW = 'deleted';

function compareSmallArrayToBigArray(smlArray, bigArray, statusNotInSml, statusNotInBig, options) {
    let editDistanceMatrix = [],
        smlIndex, smlIndexMax = smlArray.length,
        bigIndex, bigIndexMax = bigArray.length,
        compareRange = (bigIndexMax - smlIndexMax) || 1,
        maxDistance = smlIndexMax + bigIndexMax + 1,
        thisRow, lastRow,
        bigIndexMaxForRow, bigIndexMinForRow;

    for (smlIndex = 0; smlIndex <= smlIndexMax; smlIndex++) {
        lastRow = thisRow;
        editDistanceMatrix.push(thisRow = []);
        bigIndexMaxForRow = Math.min(bigIndexMax, smlIndex + compareRange);
        bigIndexMinForRow = smlIndex > 1 ? smlIndex - 1 : 0;
        for (bigIndex = bigIndexMinForRow; bigIndex <= bigIndexMaxForRow; bigIndex++) {
            if (!bigIndex) {
                thisRow[bigIndex] = smlIndex + 1;
            } else if (!smlIndex) { // Top row - transform empty array into new array via additions
                thisRow[bigIndex] = bigIndex + 1;
            } else if (smlArray[smlIndex - 1] === bigArray[bigIndex - 1]) {
                thisRow[bigIndex] = lastRow[bigIndex - 1];                  // copy value (no edit)
            } else {
                let northDistance = lastRow[bigIndex] || maxDistance;       // not in big (deletion)
                let westDistance = thisRow[bigIndex - 1] || maxDistance;    // not in small (addition)
                thisRow[bigIndex] = (northDistance < westDistance ? northDistance : westDistance) + 1;
            }
        }
    }

    let editScript = [], meMinusOne, notInSml = [], notInBig = [], nextEditScriptIndex = 0;
    for (smlIndex = smlIndexMax, bigIndex = bigIndexMax; smlIndex || bigIndex;) {
        meMinusOne = editDistanceMatrix[smlIndex][bigIndex] - 1;
        if (bigIndex && meMinusOne === editDistanceMatrix[smlIndex][bigIndex - 1]) {
            notInSml.push(editScript[nextEditScriptIndex++] = {     // added
                'status': statusNotInSml,
                'value': bigArray[--bigIndex],
                'index': bigIndex
            });
        } else if (smlIndex && meMinusOne === editDistanceMatrix[smlIndex - 1][bigIndex]) {
            notInBig.push(editScript[nextEditScriptIndex++] = {     // deleted
                'status': statusNotInBig,
                'value': smlArray[--smlIndex],
                'index': smlIndex
            });
        } else {
            --bigIndex;
            --smlIndex;
            if (!options['sparse']) {
                editScript[nextEditScriptIndex++] = {
                    'status': "retained",
                    'value': bigArray[bigIndex]
                };
            }
        }
    }

    // Set a limit on the number of consecutive non-matching comparisons; having it a multiple of
    // smlIndexMax keeps the time complexity of this algorithm linear.
    findMovesInArrayComparison(notInBig, notInSml, !options['dontLimitMoves'] && smlIndexMax * 10);

    return editScript.reverse();
}
