export class Graph {
  private adjacencyList: Map<string, string[]>;

  constructor() {
    this.adjacencyList = new Map();
  }

  addVertex(vertex: string): void {
    if (!this.adjacencyList.has(vertex)) {
      this.adjacencyList.set(vertex, []);
    }
  }

  addEdge(source: string, destination: string): void {
    this.addVertex(source);
    this.addVertex(destination);
    this.adjacencyList.get(source)!.push(destination);
  }

  topologicalSort(): string[] {
    const visited = new Set<string>();
    const stack: string[] = [];

    const dfs = (vertex: string) => {
      visited.add(vertex);
      const neighbors = this.adjacencyList.get(vertex) || [];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        }
      }

      stack.push(vertex);
    };

    for (const vertex of this.adjacencyList.keys()) {
      if (!visited.has(vertex)) {
        dfs(vertex);
      }
    }

    return stack.reverse();
  }
}
