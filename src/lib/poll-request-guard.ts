interface PollRequestToken {
  requestSequence: number
  mutationVersion: number
}

export class PollRequestGuard {
  private requestSequence = 0
  private mutationVersion = 0

  begin(): PollRequestToken {
    this.requestSequence += 1
    return {
      requestSequence: this.requestSequence,
      mutationVersion: this.mutationVersion,
    }
  }

  isCurrent(request: PollRequestToken): boolean {
    return (
      request.requestSequence === this.requestSequence &&
      request.mutationVersion === this.mutationVersion
    )
  }

  invalidate(): void {
    this.mutationVersion += 1
  }
}