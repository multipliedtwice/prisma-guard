// The extension context Prisma binds as `this` on an $allModels method.
//
// One place that knows this shape. It is restated at ~90 call sites otherwise,
// and each one carries a cast — so a change to how the model or delegate is
// resolved would have to be made ~90 times, and a site missed would fail as a
// wrong-delegate routing bug rather than as a type error.
//
// The cast is confined here on purpose: these tests drive the extension without
// a real Prisma client, so the receiver is a stand-in for a type only Prisma can
// produce. What it stands in for is asserted in model-guard-allmodels.test.ts.
export function guardCtx(
  model: string,
  parent: Record<string, unknown>,
): unknown {
  return { $name: model, $parent: parent };
}
