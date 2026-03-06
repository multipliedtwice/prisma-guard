export const GUARD_CONFIG = {
  onMissingScopeContext: "error",
  findUniqueMode: "reject",
} as const

export const SCOPE_MAP = {
  User: [{ fk: "companyId", root: "Company", relationName: "company" }],
} as const

export type ScopeRoot = 'Company'

export const TYPE_MAP = {
  "Company": {
    "id": { type: "String", isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    "name": { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    "users": { type: "User", isList: true, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
  "User": {
    "id": { type: "String", isList: false, isRequired: true, isId: true, isRelation: false, hasDefault: true, isUpdatedAt: false },
    "email": { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    "name": { type: "String", isList: false, isRequired: false, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    "companyId": { type: "String", isList: false, isRequired: true, isId: false, isRelation: false, hasDefault: false, isUpdatedAt: false },
    "company": { type: "Company", isList: false, isRequired: true, isId: false, isRelation: true, hasDefault: false, isUpdatedAt: false },
  },
} as const

export const ENUM_MAP = {

} as const

export type ModelName = keyof typeof TYPE_MAP
export type FieldName<M extends ModelName> = keyof (typeof TYPE_MAP)[M]

export const ZOD_CHAINS = {
  "User": {
    "email": (base: any) => base.email(),
  },
}
