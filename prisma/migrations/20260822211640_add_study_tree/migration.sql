-- CreateTable
CREATE TABLE "study_trees" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_tree_nodes" (
    "id" TEXT NOT NULL,
    "treeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_tree_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tree_checks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tree_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "study_trees_courseId_key" ON "study_trees"("courseId");

-- CreateIndex
CREATE INDEX "study_tree_nodes_treeId_parentId_idx" ON "study_tree_nodes"("treeId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "study_tree_nodes_treeId_code_key" ON "study_tree_nodes"("treeId", "code");

-- CreateIndex
CREATE INDEX "user_tree_checks_expiresAt_idx" ON "user_tree_checks"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_tree_checks_userId_nodeId_key" ON "user_tree_checks"("userId", "nodeId");

-- AddForeignKey
ALTER TABLE "study_trees" ADD CONSTRAINT "study_trees_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_trees" ADD CONSTRAINT "study_trees_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_tree_nodes" ADD CONSTRAINT "study_tree_nodes_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "study_trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_tree_nodes" ADD CONSTRAINT "study_tree_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "study_tree_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tree_checks" ADD CONSTRAINT "user_tree_checks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tree_checks" ADD CONSTRAINT "user_tree_checks_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "study_tree_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
