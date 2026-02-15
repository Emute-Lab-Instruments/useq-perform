const nodePath = require('path');

const SOLID_BUILTINS = new Set([
  'Show', 'Switch', 'Match', 'For', 'Index',
  'Portal', 'Suspense', 'Dynamic', 'ErrorBoundary',
]);

function isPascalCase(name) {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function getRelativePath(filename, sourceRoot) {
  if (!filename) return null;
  const root = sourceRoot || process.cwd();
  return nodePath.relative(root, filename);
}

function getRootJSXElement(path, t) {
  const body = path.get('body');

  // Arrow with expression body: () => <div>...</div>
  if (body.isJSXElement()) return body;

  // Block body: find top-level return statements
  if (body.isBlockStatement()) {
    let found = null;
    body.traverse({
      ReturnStatement(retPath) {
        if (found) return;
        // Only top-level returns, not from nested functions
        const fnParent = retPath.getFunctionParent();
        if (fnParent !== path) return;

        const arg = retPath.get('argument');
        if (arg.isJSXElement()) {
          found = arg;
        } else if (arg.isParenthesizedExpression()) {
          const expr = arg.get('expression');
          if (expr.isJSXElement()) found = expr;
        }
      },
    });
    return found;
  }

  return null;
}

function isSolidBuiltin(jsxElementPath) {
  const name = jsxElementPath.node.openingElement.name;
  return name.type === 'JSXIdentifier' && SOLID_BUILTINS.has(name.name);
}

function injectAttributes(jsxElementPath, componentName, filename, opts, t) {
  if (isSolidBuiltin(jsxElementPath)) return;

  const attrs = jsxElementPath.node.openingElement.attributes;

  // Don't add if already present
  if (attrs.some(a => t.isJSXAttribute(a) && a.name?.name === 'data-component')) {
    return;
  }

  attrs.push(
    t.jsxAttribute(
      t.jsxIdentifier('data-component'),
      t.stringLiteral(componentName),
    ),
  );

  const relPath = getRelativePath(filename, opts.sourceRoot);
  if (relPath) {
    attrs.push(
      t.jsxAttribute(
        t.jsxIdentifier('data-source'),
        t.stringLiteral(relPath),
      ),
    );
  }
}

function processFunction(fnPath, name, state, t) {
  if (!isPascalCase(name)) return;
  const jsxElement = getRootJSXElement(fnPath, t);
  if (!jsxElement) return;
  injectAttributes(jsxElement, name, state.filename, state.opts || {}, t);
}

module.exports = function babelSolidLabel({ types: t }) {
  return {
    name: 'babel-solid-label',
    visitor: {
      FunctionDeclaration(path, state) {
        const name = path.node.id?.name;
        if (name) processFunction(path, name, state, t);
      },
      VariableDeclarator(path, state) {
        const name = path.node.id?.name;
        const init = path.get('init');
        if (name && (init.isArrowFunctionExpression() || init.isFunctionExpression())) {
          processFunction(init, name, state, t);
        }
      },
    },
  };
};
