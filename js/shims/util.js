"use strict";

module.exports = {
  inherits(ctor, superCtor) {
    if (superCtor) {
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
      Object.setPrototypeOf(ctor, superCtor);
    }
  },
  promisify(fn) {
    return function (...args) {
      return new Promise((resolve, reject) => {
        fn.call(this, ...args, (err, ...vals) => {
          if (err) reject(err);
          else resolve(vals.length > 1 ? vals : vals[0]);
        });
      });
    };
  },
};
