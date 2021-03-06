"use strict"

const Entry = require("./entry.js")
const utils = require("./utils.js")

function Runtime() {}
const Rp = Object.setPrototypeOf(Runtime.prototype, null)

// The exports.enable method can be used to enable the @std/esm runtime for
// specific module objects, or for Module.prototype (where implemented),
// to make the runtime available throughout the entire module system.
function enable(mod) {
  if (typeof mod.export !== "function" ||
      typeof mod.import !== "function") {
    const proto = this.prototype
    for (const key in proto) {
      mod[key] = proto[key]
    }
    return true
  }

  return false
}

Runtime.enable = enable

// Register getter functions for local variables in the scope of an export
// statement. Pass true as the second argument to indicate that the getter
// functions always return the same values.
function moduleExport(getters, constant) {
  setESModuleAndOwner(this)

  const entry = Entry.getOrCreate(this.exports, this)
  entry.addGetters(getters, constant)

  if (this.loaded) {
    // If the module has already been evaluated, then we need to trigger
    // another round of entry.runSetters calls, which begins by calling
    // entry.runGetters(module).
    entry.runSetters()
  }
}

Rp.export = moduleExport

// Register a getter function that always returns the given value.
function moduleExportDefault(value) {
  return this.export({
    default() {
      return value
    }
  }, true)
}

Rp.exportDefault = moduleExportDefault

function moduleImport(id) {
  return Promise.resolve().then(() => {
    const exported = this.require(utils.resolvePath(id, this))
    const ns = Object.create(null)

    this.watch(exported, {
      "*"(value, name) {
        ns[name] = value
      }
    }, void 0, [ns])

    return ns
  })
}

Rp.import = moduleImport

// If key is provided, it will be used to identify the given setters so
// that they can be replaced if module.importSync is called again with the
// same key. This avoids potential memory leaks from import declarations
// inside loops. The compiler generates these keys automatically (and
// deterministically) when compiling nested import declarations.
function moduleImportSync(id, setters, key, namespaces) {
  const exported = this.require(utils.resolvePath(id, this))
  return this.watch(exported, setters, key, namespaces)
}

Rp.importSync = moduleImportSync

function run(wrapper) {
  setESModuleAndOwner(this)
  wrapper()
  this.loaded = true
  this.runSetters()
}

Rp.run = run

// Platform-specific code should find a way to call this method whenever
// the module system is about to return module.exports from require. This
// might happen more than once per module, in case of dependency cycles,
// so we want Module.prototype.runSetters to run each time.
function runSetters(valueToPassThrough) {
  let entry = Entry.get(this.exports)
  if (entry !== null) {
    // If there's not already an Entry object for this module, then there
    // won't be any setters to run.
    entry.runSetters()
  }

  if (this.loaded) {
    // If this module has already loaded, then we have to create an Entry
    // object here, so that we can call entry.onLoaded(), which sets
    // entry.loaded true for any future modules that might want to import
    // from this module. If we don't create the Entry now, we'll never
    // have another chance to call entry.onLoaded().
    if (entry === null) {
      entry = Entry.getOrCreate(this.exports, this)
    }

    // Multiple modules can share the same Entry object because they share
    // the same module.exports object, e.g. when a "bridge" module sets
    // module.exports = require(...) to make itself roughly synonymous
    // with some other module. Just because the bridge module has finished
    // loading (as far as it's concerned), that doesn't mean it should
    // control the loading state of the (possibly shared) Entry. Long
    // story short: we should only call entry.onLoaded() if this module is
    // the owner of this Entry object.
    if (entry.owner === this) {
      entry.onLoaded()
    }
  }

  // Assignments to exported local variables get wrapped with calls to
  // module.runSetters, so module.runSetters returns the
  // valueToPassThrough parameter to allow the value of the original
  // expression to pass through. For example,
  //
  //   export let a = 1
  //   console.log(a += 3)
  //
  // becomes
  //
  //   module.export("a", () => a)
  //   let a = 1
  //   console.log(module.runSetters(a += 3))
  //
  // This ensures module.runSetters runs immediately after the assignment,
  // and does not interfere with the larger computation.
  return valueToPassThrough
}

Rp.runSetters =
Rp.runModuleSetters = runSetters

function watch(exported, setters, key, namespaces) {
  setESModuleAndOwner(this)

  if (utils.isObject(setters)) {
    Entry.getOrCreate(exported)
      .addSetters(this, setters, key, namespaces)
  }
}

Rp.watch = watch

function setESModuleAndOwner(mod) {
  utils.setESModule(mod.exports)
  Entry.getOrCreate(mod.exports, mod)
}

module.exports = Runtime
