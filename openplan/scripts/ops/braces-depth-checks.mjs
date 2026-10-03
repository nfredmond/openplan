import assert from 'node:assert/strict';

// Exercise the public APIs and direct syntax-tree entry points independently of hashes.
export function checkBracesDepth(braces) {
  const pattern = (count, left = '{', right = '}') => left.repeat(count) + 'a,b' + right.repeat(count);
  const ast = (count, root = true) => {
    let node = { type: 'text', value: 'a' };
    for (let i = 0; i < count; i++) node = { type: 'brace', nodes: [node] };
    return root ? { type: 'root', nodes: [node] } : node;
  };
  const rejects = (fn, label) => assert.throws(fn, /exceeds max depth/, label);
  assert.deepEqual(braces.expand('src/{app,lib}/file{1..3}.ts'), [
    'src/app/file1.ts', 'src/app/file2.ts', 'src/app/file3.ts',
    'src/lib/file1.ts', 'src/lib/file2.ts', 'src/lib/file3.ts',
  ]);
  assert.equal(braces.compile('src/{app,lib}/*.ts'), 'src/(app|lib)/*.ts');
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    for (const [left, right] of [['{', '}'], ['(', ')']]) {
      assert.doesNotThrow(() => braces[method](pattern(100, left, right)), `${method}: depth 100`);
      for (const depth of [101, 4000]) rejects(() => braces[method](pattern(depth, left, right)), `${method}: depth ${depth}`);
    }
    rejects(() => braces[method]('{('.repeat(51) + 'a,b' + ')}'.repeat(51)), `${method}: combined nesting`);
    for (const maxDepth of [101, 100000, Infinity, NaN]) {
      rejects(() => braces[method](pattern(101), { maxDepth }), `${method}: cannot raise limit`);
    }
    rejects(() => braces[method](pattern(2), { maxDepth: 1 }), `${method}: lower limit`);
    assert.doesNotThrow(() => braces[method](pattern(2), { maxDepth: 2 }));
    assert.throws(() => braces[method]('a'.repeat(10001)), /exceeds max characters/);
  }
  for (const method of ['stringify', 'compile', 'expand']) {
    for (const root of [true, false]) {
      assert.doesNotThrow(() => braces[method](ast(100, root)), `${method}: AST boundary`);
      rejects(() => braces[method](ast(101, root)), `${method}: direct AST`);
      rejects(() => braces[method](ast(101, root), { maxDepth: Infinity }), `${method}: AST infinite limit`);
      rejects(() => braces[method](ast(2, root), { maxDepth: 1 }), `${method}: AST lower limit`);
    }
    const cyclic = { type: 'brace', nodes: [] };
    cyclic.nodes.push(cyclic);
    rejects(() => braces[method]({ type: 'root', nodes: [cyclic] }), `${method}: cyclic children`);
  }
}
