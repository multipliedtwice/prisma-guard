# [1.31.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.30.0...v1.31.0) (2026-07-16)


### Features

* add relationFromFields to FieldMeta and enhance validation for relation covered foreign keys ([e5f9c01](https://github.com/multipliedtwice/prisma-guard/commit/e5f9c01fd25f3616347c361f7c4989a0304811af))

# [1.30.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.29.0...v1.30.0) (2026-07-06)


### Features

* add isObjectLike utility function to check for non-null objects ([9b691c8](https://github.com/multipliedtwice/prisma-guard/commit/9b691c8766baa8c2ce3f0a7ffe47be20d4a7d56b))

# [1.29.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.28.1...v1.29.0) (2026-07-05)


### Bug Fixes

* improve formatting of scope map entries in emitScopeMap function ([4f49e17](https://github.com/multipliedtwice/prisma-guard/commit/4f49e175a954793fc507ccb4a9bbc79f7edfbc85))
* remove conflicting shape properties in createQueryBuilder ([f39f174](https://github.com/multipliedtwice/prisma-guard/commit/f39f174088a28fb0063d5f2a3d79b738c7c76783))


### Features

* add read planning with resolve() to enhance guard functionality ([93b8523](https://github.com/multipliedtwice/prisma-guard/commit/93b85238fa5c9b8c9a7b7737133daa0b3f23fcf5))
* add resolve method to enhance model guard functionality ([1c1cf7d](https://github.com/multipliedtwice/prisma-guard/commit/1c1cf7d7786968e618fbf56985ad74c4621481c7))
* Enhance query builder and projection handling ([3b115e6](https://github.com/multipliedtwice/prisma-guard/commit/3b115e67325dea4cb2e97914d59705c4dbf1c57a))

## [1.28.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.28.0...v1.28.1) (2026-07-03)


### Bug Fixes

* update operation shape keys to include additional parameters for CRUD operations ([9d16b3b](https://github.com/multipliedtwice/prisma-guard/commit/9d16b3bee156a8437dd2ebb5da3fc25dc6fe0d0a))

# [1.28.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.27.1...v1.28.0) (2026-07-03)


### Features

* enhance type handling and validation in the schema ([4c5f333](https://github.com/multipliedtwice/prisma-guard/commit/4c5f333cb3cd1e8b952b4db08957a64529cbe45d))

## [1.27.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.27.0...v1.27.1) (2026-06-25)


### Bug Fixes

* enhance inline forced field handling to support merging with existing values ([7b2b359](https://github.com/multipliedtwice/prisma-guard/commit/7b2b35903490649e9a4d785db451bed120afb971))

# [1.27.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.26.2...v1.27.0) (2026-06-25)


### Features

* implement inline merging for forced where conditions and enhance scalar equality checks ([cbd3f4c](https://github.com/multipliedtwice/prisma-guard/commit/cbd3f4c62b823a245519572e7fd5a54790498ced))

## [1.26.2](https://github.com/multipliedtwice/prisma-guard/compare/v1.26.1...v1.26.2) (2026-06-22)


### Bug Fixes

* refactor emitClient and createModelGuardExtension to enhance model delegation and guard interface generation ([c7717fb](https://github.com/multipliedtwice/prisma-guard/commit/c7717fb337985276f084db74cdb8c09a386fea0b))
* replace $allModels.guard with specific model guards for improved clarity and functionality ([b551431](https://github.com/multipliedtwice/prisma-guard/commit/b551431428021ed88c15812e226b6114dc989a54))

## [1.26.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.26.0...v1.26.1) (2026-06-15)


### Bug Fixes

* improve toPlainObject function to handle various data types and ensure proper normalization of request body ([73612d4](https://github.com/multipliedtwice/prisma-guard/commit/73612d4b2239a86a5f306301d28b8a72b3be248e))

# [1.26.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.25.0...v1.26.0) (2026-06-13)


### Features

* enhance createWhereBuilder to support optional field schemas for scalar and relation conditions ([9cc1674](https://github.com/multipliedtwice/prisma-guard/commit/9cc1674407fe979748aa602c3049b6fe507781a5))

# [1.25.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.24.0...v1.25.0) (2026-05-20)


### Bug Fixes

* update buildCursorSchema to accept unknown config type ([375c3de](https://github.com/multipliedtwice/prisma-guard/commit/375c3de184e7031c7f9d13f163f2d7465f62e1c9))


### Features

* enhance unique constraints handling in type definitions and queries ([b8ac070](https://github.com/multipliedtwice/prisma-guard/commit/b8ac070dd1f5b16a1da0d51e9d6982cb1baa6da7))

# [1.24.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.23.0...v1.24.0) (2026-05-19)


### Features

* enhance emitClient function to accept dynamic Prisma client import and refactor related code ([83c6bb2](https://github.com/multipliedtwice/prisma-guard/commit/83c6bb2139afe6a1dbde3b63539d0619651eeee2))

# [1.23.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.22.3...v1.23.0) (2026-05-19)


### Features

* add ListRelationFields type and enhance TypedCountSelect for better relation handling ([427e043](https://github.com/multipliedtwice/prisma-guard/commit/427e0439ebfc32268ae8b8533ea43391e90a81da))

## [1.22.3](https://github.com/multipliedtwice/prisma-guard/compare/v1.22.2...v1.22.3) (2026-05-19)


### Bug Fixes

* add TypedCountSelect type to emitted shapes in emitTypedShapes function ([09c847d](https://github.com/multipliedtwice/prisma-guard/commit/09c847deecc431e1947bd4c00a46a4fc4ec04551))

## [1.22.2](https://github.com/multipliedtwice/prisma-guard/compare/v1.22.1...v1.22.2) (2026-05-18)


### Bug Fixes

* refine OperationShape type and enhance ShapeInput structure for better type handling ([6cb3de8](https://github.com/multipliedtwice/prisma-guard/commit/6cb3de8c8c4a131613fbafb4144f50e6fe7a921f))

## [1.22.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.22.0...v1.22.1) (2026-05-18)


### Bug Fixes

* remove unused namedShapes and NamedShapeMap from typed-shape.ts ([8ef0fa5](https://github.com/multipliedtwice/prisma-guard/commit/8ef0fa510462f47086c6280f13f1b408f8bb4da2))

# [1.22.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.21.1...v1.22.0) (2026-05-18)


### Features

* add typed shapes and operation shape keys for enhanced type safety in query generation ([6007978](https://github.com/multipliedtwice/prisma-guard/commit/6007978c3b559110ae77911c385f800880f86e07))

## [1.21.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.21.0...v1.21.1) (2026-04-21)


### Bug Fixes

* **scalar-base.ts:** improve integer coercion by using Math.trunc to handle non-integer values correctly ([7e350f6](https://github.com/multipliedtwice/prisma-guard/commit/7e350f668306fe891f06d24dd3bf1cbdbb3b6285))
* update validation logic to accept exponent with '+' sign and improve date parsing in schemas ([172f678](https://github.com/multipliedtwice/prisma-guard/commit/172f6780764628e711669a8532e2f7f223678fcd))

# [1.21.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.20.0...v1.21.0) (2026-04-21)


### Features

* realtion support, better error handling ([11dc15d](https://github.com/multipliedtwice/prisma-guard/commit/11dc15d072cd154d08187223fbd9ee302d3402a1))

# [1.20.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.19.0...v1.20.0) (2026-04-20)


### Features

* **model-guard.ts:** add unique where validation and handling for model guards to enforce unique constraints ([781e1a6](https://github.com/multipliedtwice/prisma-guard/commit/781e1a6d1449ba478388bd7a7b8ce272c18ce71d))

# [1.19.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.18.1...v1.19.0) (2026-04-20)


### Features

* **query-builder-where.ts:** enhance operators handling to support boolean and non-object values for better flexibility in query conditions ([f793f8e](https://github.com/multipliedtwice/prisma-guard/commit/f793f8edf68a4f3a2d5da70c6bb0b1bee50172ea))

## [1.18.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.18.0...v1.18.1) (2026-04-20)


### Bug Fixes

* **query-builder-forced.ts:** enhance collectEqualityFields function to handle non-object values correctly ([df3e072](https://github.com/multipliedtwice/prisma-guard/commit/df3e0723c8be1c2382e5633e1f4d4aa02a7de2c8))

# [1.18.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.17.0...v1.18.0) (2026-04-20)


### Bug Fixes

* **model-guard.test.ts:** update test assertions to match expected data shape for id to simplify the comparison logic ([36825e7](https://github.com/multipliedtwice/prisma-guard/commit/36825e752508464b73912c828899d6ce0824a48e))


### Features

* **model-guard.ts:** add normalizeUniqueWhere function to simplify unique where conditions and improve code readability ([afac21b](https://github.com/multipliedtwice/prisma-guard/commit/afac21b43a59675fe5bbaa0ce5d71bbbdb03420f))

# [1.17.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.16.0...v1.17.0) (2026-04-20)


### Features

* **query-builder:** enhance JSON support in query builder with new operators and compatibility checks ([69f4630](https://github.com/multipliedtwice/prisma-guard/commit/69f4630bb6ab801b57a1d91b7bf0a1de28875935))

# [1.16.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.15.0...v1.16.0) (2026-04-20)


### Features

* **scalar-base.ts:** enhance scalar type handling with string and number transformations for String, Int, and Float ([f4c10cb](https://github.com/multipliedtwice/prisma-guard/commit/f4c10cbbf7a0d2a037589fca6c0f233a59c12555))

# [1.15.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.14.1...v1.15.0) (2026-04-20)


### Features

* **constants.ts:** add unsupported marker and related functions to handle unsupported values ([264fc98](https://github.com/multipliedtwice/prisma-guard/commit/264fc98a07bcabf38dce63288e3ef8fa569dafad))

## [1.14.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.14.0...v1.14.1) (2026-04-20)


### Bug Fixes

* force version bump ([0637501](https://github.com/multipliedtwice/prisma-guard/commit/06375012d98e03e9ddaf41c905c1937b791d615b))

# [1.14.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.13.1...v1.14.0) (2026-04-20)


### Features

* **generator:** add support for unsupported field kind in type map generation ([a4202df](https://github.com/multipliedtwice/prisma-guard/commit/a4202dfd98e977f455f6c3d3f16bafd36dba4421))

## [1.13.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.13.0...v1.13.1) (2026-04-20)


### Bug Fixes

* improve error message for deleteMany config and enhance schema validation ([31c1a01](https://github.com/multipliedtwice/prisma-guard/commit/31c1a01795bccc5605a139c9ad6e23e24cfb9731))

# [1.13.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.12.0...v1.13.0) (2026-04-20)


### Features

* enhance upsert validation logic for to-many and to-one relationships ([3dc6fb1](https://github.com/multipliedtwice/prisma-guard/commit/3dc6fb193fc17d5d06fd77ccd29f944a9c05ce0f))

# [1.12.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.11.0...v1.12.0) (2026-04-20)


### Features

* enhance relation handling in data schema with new validation and schema building functions ([5a6d5ed](https://github.com/multipliedtwice/prisma-guard/commit/5a6d5eda023d97f62cbf78954422a3d10c9c1961))

# [1.11.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.10.0...v1.11.0) (2026-04-20)


### Features

* update createWhereBuilder to use equalsBase directly in fieldSchemas ([487d53a](https://github.com/multipliedtwice/prisma-guard/commit/487d53adb19c776f75f4fb2043fccc774d68050c))

# [1.10.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.9.1...v1.10.0) (2026-04-19)


### Features

* enhance createWhereBuilder to support scalar shorthand values and improve operator validation ([0c47c1b](https://github.com/multipliedtwice/prisma-guard/commit/0c47c1b8940ca3df0fb00858b101f04cdf94fb42))
* integrate coerceToArray utility for improved array handling in query builders and schemas ([83b1861](https://github.com/multipliedtwice/prisma-guard/commit/83b1861819a2410b1d70243c9c85a16dbb20dffc))
* simplify operator validation in createWhereBuilder by removing redundant checks ([ab5b15d](https://github.com/multipliedtwice/prisma-guard/commit/ab5b15d1c1cc50a9b4b7a175e0e1b7a8ff34e155))

## [1.9.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.9.0...v1.9.1) (2026-04-19)


### Bug Fixes

* **model-guard.ts, query-builder.ts, query-builder-forced.ts:** remove redundant checks for both "select" and "include" in shape definitions to simplify error handling ([908ad96](https://github.com/multipliedtwice/prisma-guard/commit/908ad96de519b00f876c28e0dde6a721bbd6359a))
* tests ([eb01b8f](https://github.com/multipliedtwice/prisma-guard/commit/eb01b8ff0bd6e96f307ae23636515e06813929a1))
* tests ([3783dc4](https://github.com/multipliedtwice/prisma-guard/commit/3783dc429dccf811dfe48d11a4f34356ceb96022))

# [1.9.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.8.0...v1.9.0) (2026-04-18)


### Features

* **model-guard:** add support for include in projection and selection logic to enhance data retrieval capabilities ([ae601ae](https://github.com/multipliedtwice/prisma-guard/commit/ae601ae8c0d6c9b65fc71bf420677bf456bd52ae))

# [1.8.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.7.0...v1.8.0) (2026-04-18)


### Features

* read schema projection ([d3fa602](https://github.com/multipliedtwice/prisma-guard/commit/d3fa602160761f1dc1202d7f653597a83ed8d051))

# [1.7.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.6.1...v1.7.0) (2026-04-18)


### Bug Fixes

* **query-builder.ts:** cast shape.orderBy to Record<string, OrderByFieldConfig> for type safety in orderBy schema building ([81dffb9](https://github.com/multipliedtwice/prisma-guard/commit/81dffb96c015a6c5059a9ce81918446bb4062cdf))


### Features

* **query-builder.ts, types.ts:** enhance orderBy handling in groupBy to support flexible configurations and improve validation logic ([2276556](https://github.com/multipliedtwice/prisma-guard/commit/227655652f7dfcc5b1545d8aaea17f4a96989922))

## [1.6.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.6.0...v1.6.1) (2026-04-18)


### Bug Fixes

* **query-builder-forced.ts:** simplify where condition handling in applyBuiltShape function for better readability and maintainability ([7509142](https://github.com/multipliedtwice/prisma-guard/commit/75091428f4f6842cd7302ac0813f11a85fc68b95))

# [1.6.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.5.1...v1.6.0) (2026-04-18)


### Features

* **query-builder-forced.ts:** add handling for bodyObj with forcedWhere and missing zodSchema to improve query parsing logic ([1776952](https://github.com/multipliedtwice/prisma-guard/commit/1776952988f801041e93c5029a12949c8351270c))

## [1.5.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.5.0...v1.5.1) (2026-04-18)


### Bug Fixes

* groupBy ([89643f7](https://github.com/multipliedtwice/prisma-guard/commit/89643f774e88438f1d1111cc2ddd2bed7bc49d3c))

# [1.5.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.4.1...v1.5.0) (2026-04-18)


### Features

* **query-builder-where.ts:** add support for "mode" operator in where clause to enhance query flexibility ([29a30a1](https://github.com/multipliedtwice/prisma-guard/commit/29a30a1268edde324834dc6a2f37ba683cd06b6c))

## [1.4.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.4.0...v1.4.1) (2026-04-01)


### Bug Fixes

* strip forced key from zod ([48df7dd](https://github.com/multipliedtwice/prisma-guard/commit/48df7ddde65dec82567e8166eada054bc5486a64))

# [1.4.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.3.1...v1.4.0) (2026-03-31)


### Features

* **query-builder:** enhance orderBy configuration to support nested objects and validation for scalar fields ([7f879fb](https://github.com/multipliedtwice/prisma-guard/commit/7f879fbbff4b006beba0d4a4b7a1c52b055fdf63))

## [1.3.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.3.0...v1.3.1) (2026-03-31)


### Bug Fixes

* **emit-client.ts:** remove file extension from import statements for consistency and to avoid potential issues with module resolution ([63cd30d](https://github.com/multipliedtwice/prisma-guard/commit/63cd30d79d19ce5c3f96eb09bc756eb0ea982d8d))

# [1.3.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.2.1...v1.3.0) (2026-03-31)


### Features

* **package.json:** update module entry points to support both ESM and CJS formats for better compatibility ([fff2323](https://github.com/multipliedtwice/prisma-guard/commit/fff2323b50edd10dc000c05684b10f03d069506e))

## [1.2.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.2.0...v1.2.1) (2026-03-10)


### Bug Fixes

* security and correctness improvements ([1ba4bfc](https://github.com/multipliedtwice/prisma-guard/commit/1ba4bfc56cf8b6ecccc8aa396e570d84f4d0ebe1))

# [1.2.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.1.0...v1.2.0) (2026-03-09)


### Features

* Logical combinators and Relation filters in where shapes ([29e2d1f](https://github.com/multipliedtwice/prisma-guard/commit/29e2d1fd62257114e591cc6fd680c9c493f2b3a4))

# [1.1.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.0.1...v1.1.0) (2026-03-08)


### Features

* **model-guard.ts:** add support for projection in create, update, and delete methods to enhance data handling flexibility ([dc6c7ec](https://github.com/multipliedtwice/prisma-guard/commit/dc6c7ec6027046ecaca098be41da089fa878f3ce))

## [1.0.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.0.0...v1.0.1) (2026-03-08)


### Bug Fixes

* correctness fixes ([e7c2039](https://github.com/multipliedtwice/prisma-guard/commit/e7c20396f6536a5e137d1a863c4d3261c8486017))

# 1.0.0 (2026-03-07)


### Bug Fixes

* generator test ([1ffe17d](https://github.com/multipliedtwice/prisma-guard/commit/1ffe17d59abf602a333eb1e9bbde2b097a059091))


### Features

* initial release ([6b1af5c](https://github.com/multipliedtwice/prisma-guard/commit/6b1af5c3294c6599e422c5cfb2d38f5a3e07e01f))
* **og.png:** add Open Graph image for improved social media sharing ([7577dc5](https://github.com/multipliedtwice/prisma-guard/commit/7577dc5362f92be08d3bc5a7c10e96d32ef1a07f))
