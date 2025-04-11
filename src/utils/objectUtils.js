/**
 * Deep merges two objects, copying all properties from source into target
 * @param {Object} target - The target object to merge into
 * @param {Object} source - The source object to merge from
 * @returns {Object} The merged object
 */
function deepMerge(target, source) {
  if (!source) {
    return target;
  }

  const output = { ...target };

  Object.keys(source).forEach(key => {
    if (source[key] && typeof source[key] === 'object') {
      if (target[key] && typeof target[key] === 'object') {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = { ...source[key] };
      }
    } else if (source[key] !== undefined) {
      output[key] = source[key];
    }
  });

  return output;
}

module.exports = {
  deepMerge
}; 