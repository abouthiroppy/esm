"use strict"

const AV = require("./assignment-visitor.js")
const FastPath = require("./fast-path.js")
const getOption = require("./options.js").get
const IEV = require("./import-export-visitor.js")

const assignmentVisitor = new AV
const importExportVisitor = new IEV
const codeOfPound = "#".charCodeAt(0)
const shebangRegExp = /^#!.*/

// Matches any import or export identifier as long as it's not preceded by
// a `.` character (to avoid matching module.export, for example). Because
// @std/esm replaces all import and export declarations with module.import
// and module.export calls, this logic should prevent the compiler from
// ever having to recompile code it has already compiled.
const importExportRegExp = /(?:^|[^.])\b(?:im|ex)port\b/

function compile(code, options) {
  options = Object.assign(Object.create(null), options)

  if (code.charCodeAt(0) === codeOfPound) {
    code = code.replace(shebangRegExp, "")
  }

  const parse = getOption(options, "parse")
  const sourceType = getOption(options, "sourceType")
  const ast = parse(code)

  const result = {
    code,
    sourceType: "script"
  }

  if (sourceType === "script" ||
      (sourceType === "unambiguous" && ! importExportRegExp.test(code))) {
    return result
  }

  const rootPath = new FastPath(ast)
  options.moduleAlias = makeUniqueId(getOption(options, "moduleAlias"), code)

  importExportVisitor.visit(rootPath, code, options)
  const magicString = importExportVisitor.magicString

  if (importExportVisitor.madeChanges) {
    assignmentVisitor.visit(rootPath, {
      exportedLocalNames: importExportVisitor.exportedLocalNames,
      magicString,
      moduleAlias: importExportVisitor.moduleAlias
    })

    importExportVisitor.finalizeHoisting()
  }

  if (importExportVisitor.madeChanges || sourceType !== "unambiguous") {
    result.sourceType = "module"
  }

  result.code = magicString.toString()
  return result
}

exports.compile = compile

function makeUniqueId(id, code) {
  let match
  let n = -1
  const scanRegExp = new RegExp("\\b" + id + "(\\d*)\\b", "g")

  while ((match = scanRegExp.exec(code))) {
    n = Math.max(n, +(match[1] || 0))
  }

  return id + (n > -1 ?  ++n : "")
}

exports.makeUniqueId = makeUniqueId
