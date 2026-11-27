/** A newer import or manual edit supersedes an outstanding file read. */
export class LatestFileImport {
  private revision = 0

  cancel(): void {
    this.revision++
  }

  async run<T>(
    read: () => Promise<T>,
    publish: (value: T) => void,
    failed: (error: unknown) => void,
  ): Promise<void> {
    const revision = ++this.revision
    try {
      const value = await read()
      if (this.revision === revision) publish(value)
    } catch (error) {
      if (this.revision === revision) failed(error)
    }
  }
}
