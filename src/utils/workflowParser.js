// src/utils/workflowParser.js

/**
 * Converts React Flow nodes and edges into an ordered execution array.
 * @param {Array} nodes - Raw React Flow node objects
 * @param {Array} edges - Raw React Flow edge objects
 * @returns {Array} - An ordered checklist of task steps for Inngest background loops
 */
function parseWorkflowToPlan(nodes, edges) {
  const executionPlan = [];
  
  // 1. Trace the starting point (node with no incoming connections)
  const targetIds = new Set(edges.map(edge => edge.target));
  const startNode = nodes.find(node => !targetIds.has(node.id));
  
  if (!startNode) {
    throw new Error("Invalid workflow: Could not find a starting root node.");
  }
  
  let currentNode = startNode;
  
  // 2. Follow the arrow edges sequentially to map out the action plan
  while (currentNode) {
    executionPlan.push({
      nodeId: currentNode.id,
      type: currentNode.type,        // e.g., 'aiPrompt', 'dataFetch'
      label: currentNode.data?.label || 'Unnamed Action Step',
      config: currentNode.data?.config || {} // Extracted parameter configs
    });
    
    // Find the next arrow connection out of the active node
    const nextEdge = edges.find(edge => edge.source === currentNode.id);
    
    // Hop to the next block, or end the loop if the pathway stops
    currentNode = nextEdge ? nodes.find(node => node.id === nextEdge.target) : null;
  }
  
  return executionPlan;
}

module.exports = { parseWorkflowToPlan };
