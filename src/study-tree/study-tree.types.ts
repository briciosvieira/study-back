// The tree API's own response shapes — deliberately not 1:1 with the Prisma
// models: a leaf node carries this user's check state inline, a group node
// carries its children, and neither carries fields the other doesn't need.

export interface StudyTreeLeafView {
  id: string;
  title: string;
  order: number;
  isLeaf: true;
  checked: boolean;
  checkedAt: string | null;
  expiresAt: string | null;
}

export interface StudyTreeGroupView {
  id: string;
  title: string;
  order: number;
  isLeaf: false;
  children: StudyTreeNodeView[];
}

export type StudyTreeNodeView = StudyTreeLeafView | StudyTreeGroupView;

export interface StudyTreeView {
  id: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  nodeCount: number;
  roots: StudyTreeNodeView[];
}

// One row parsed straight from the spreadsheet, before validation.
export interface StudyTreeImportRow {
  line: number;
  nodeCode: string;
  parentCode: string | null;
  title: string;
  order: number;
}
