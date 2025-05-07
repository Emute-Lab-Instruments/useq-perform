export class ASTCursor {
    constructor(ast) {
      this.root = ast;
      this.current = ast;
      this.path = []; // Stores parent references as indices into their children arrays
    }
  
    /**
     * Get the current node
     */
    getNode() {
      return this.current;
    }
  
    /**
     * Reset to root node
     */
    reset() {
      this.current = this.root;
      this.path = [];
      return this;
    }
  
    /**
     * Move to parent node (out)
     * Stays in place if there's no parent
     */
    out() {
      if (this.path.length === 0) {
        return this; // Already at root, stay here
      }
      
      // Pop the last path element
      this.path.pop();
      
      // Navigate back to this position
      this.current = this.root;
      for (let i = 0; i < this.path.length; i++) {
        const pathSegment = this.path[i];
        this.current = this.current.children[pathSegment];
      }
      
      return this;
    }
  
    /**
     * Check if node has a parent (can go out)
     */
    canGoOut() {
      return this.path.length > 0;
    }
  
    /**
     * Move to first child (in)
     * Stays in place if there are no children
     */
    in(index = 0) {
      if (!this.hasChildren()) {
        return this; // No children, stay here
      }
      // Defensive: clamp index
      if (typeof index !== "number" || index < 0 || index >= this.current.children.length) {
        index = 0;
      }
      this.path.push(index);
      this.current = this.current.children[index];
      return this;
    }
  
    /**
     * Check if node has children (can go in)
     */
    hasChildren() {
      return this.current.children && this.current.children.length > 0;
    }
  
    /**
     * Get the number of children
     */
    childCount() {
      return this.current.children ? this.current.children.length : 0;
    }
  
    /**
     * Move to next sibling (next)
     * Stays in place if there's no next sibling
     */
    next() {
      if (!this.hasNext()) {
        return this; // No next sibling, stay here
      }
      
      const currentIndex = this.path[this.path.length - 1];
      
      // Get parent node
      const parentPath = [...this.path.slice(0, -1)];
      let parent = this.root;
      for (let i = 0; i < parentPath.length; i++) {
        parent = parent.children[parentPath[i]];
      }
      
      // Update path and current to the next sibling
      this.path[this.path.length - 1] = currentIndex + 1;
      this.current = parent.children[currentIndex + 1];
      
      return this;
    }
  
    /**
     * Check if there's a next sibling
     */
    hasNext() {
      if (this.path.length === 0) {
        return false; // Root has no siblings
      }
      
      const currentIndex = this.path[this.path.length - 1];
      
      // Get parent node
      const parentPath = [...this.path.slice(0, -1)];
      let parent = this.root;
      for (let i = 0; i < parentPath.length; i++) {
        parent = parent.children[parentPath[i]];
      }
      
      return currentIndex + 1 < parent.children.length;
    }
  
    /**
     * Move to previous sibling (prev)
     * Stays in place if there's no previous sibling
     */
    prev() {
      if (!this.hasPrev()) {
        return this; // No previous sibling, stay here
      }
      
      const currentIndex = this.path[this.path.length - 1];
      
      // Get parent node
      const parentPath = [...this.path.slice(0, -1)];
      let parent = this.root;
      for (let i = 0; i < parentPath.length; i++) {
        parent = parent.children[parentPath[i]];
      }
      
      // Update path and current to the previous sibling
      this.path[this.path.length - 1] = currentIndex - 1;
      this.current = parent.children[currentIndex - 1];
      
      return this;
    }
  
    /**
     * Check if there's a previous sibling
     */
    hasPrev() {
      if (this.path.length === 0) {
        return false; // Root has no siblings
      }
      
      const currentIndex = this.path[this.path.length - 1];
      return currentIndex > 0;
    }
  
    /**
     * Find nodes matching a criteria function
     * This is a more memory-intensive operation since it returns an array
     */
    find(criteriaFn) {
      const results = [];
      
      const traverse = (node, path = []) => {
        if (criteriaFn(node)) {
          results.push({
            node,
            path: [...path]
          });
        }
        
        if (node.children) {
          for (let i = 0; i < node.children.length; i++) {
            traverse(node.children[i], [...path, i]);
          }
        }
      };
      
      traverse(this.root);
      return results;
    }
  
    /**
     * Navigate to a specific path
     */
    navigateTo(pathArray) {
      this.reset();
      
      for (let i = 0; i < pathArray.length; i++) {
        const index = pathArray[i];
        if (!this.current.children || index >= this.current.children.length) {
          return this; // Invalid path, stay at last valid position
        }
        
        this.path.push(index);
        this.current = this.current.children[index];
      }
      
      return this;
    }
  
    /**
     * Set the cursor to a specific node by path and update current node
     * Returns this for chaining
     */
    setPath(pathArray) {
      this.reset();
      for (let i = 0; i < pathArray.length; i++) {
        const index = pathArray[i];
        if (!this.current.children || index >= this.current.children.length) {
          break;
        }
        this.path.push(index);
        this.current = this.current.children[index];
      }
      return this;
    }
  
    /**
     * Get current path
     */
    getPath() {
      return [...this.path];
    }
  
    /**
     * Create a new cursor at the current position (for when you need to branch)
     * This is one of the few operations that allocates a new object
     */
    fork() {
      const forked = new ASTCursor(this.root);
      forked.navigateTo(this.path);
      return forked;
    }
  
    /**
     * Peek at child without moving cursor
     */
    peekChild(index) {
      if (!this.hasChildren() || index >= this.current.children.length) {
        return null;
      }
      return this.current.children[index];
    }
  
    /**
     * Peek at first child without moving cursor
     */
    peekFirstChild() {
      return this.peekChild(0);
    }
  
    /**
     * Peek at last child without moving cursor
     */
    peekLastChild() {
      if (!this.hasChildren()) {
        return null;
      }
      return this.peekChild(this.current.children.length - 1);
    }
  
    /**
     * Peek at next sibling without moving cursor
     */
    peekNext() {
      if (!this.hasNext()) {
        return null;
      }
      
      const currentIndex = this.path[this.path.length - 1];
      
      // Get parent node
      const parentPath = [...this.path.slice(0, -1)];
      let parent = this.root;
      for (let i = 0; i < parentPath.length; i++) {
        parent = parent.children[parentPath[i]];
      }
      
      return parent.children[currentIndex + 1];
    }
  
    /**
     * Peek at previous sibling without moving cursor
     */
    peekPrev() {
      if (!this.hasPrev()) {
        return null;
      }
      
      const currentIndex = this.path[this.path.length - 1];
      
      // Get parent node
      const parentPath = [...this.path.slice(0, -1)];
      let parent = this.root;
      for (let i = 0; i < parentPath.length; i++) {
        parent = parent.children[parentPath[i]];
      }
      
      return parent.children[currentIndex - 1];
    }
  
    /**
     * Peek at parent without moving cursor
     */
    peekParent() {
      if (!this.canGoOut()) {
        return null;
      }
      
      const parentPath = [...this.path.slice(0, -1)];
      let parent = this.root;
      for (let i = 0; i < parentPath.length; i++) {
        parent = parent.children[parentPath[i]];
      }
      
      return parent;
    }
  
    /**
     * Depth-first traversal with a visitor function
     * Returns the cursor to its original position after traversal
     */
    traverse(visitorFn) {
      const originalPath = this.getPath();
      
      const traverseNode = (node, path = []) => {
        this.navigateTo(path);
        visitorFn(this);
        
        if (node.children) {
          for (let i = 0; i < node.children.length; i++) {
            traverseNode(node.children[i], [...path, i]);
          }
        }
      };
      
      traverseNode(this.current, originalPath);
      this.navigateTo(originalPath);
      
      return this;
    }
  }