/**
 * Deep merge two objects.
 * @param {Object} target The target object
 * @param {Object} source The source object
 * @returns {Object} The merged object
 */
function deepMerge(target, source) {
    if (!source) return target;
    const output = { ...target };

    Object.keys(source).forEach(key => {
        if (source[key] instanceof Object && key in target) {
            output[key] = deepMerge(target[key], source[key]);
        } else {
            output[key] = source[key];
        }
    });

    return output;
}

module.exports = {
    deepMerge
}; 