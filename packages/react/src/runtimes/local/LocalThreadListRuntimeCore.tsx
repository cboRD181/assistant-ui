import { ThreadListRuntimeCore, ThreadListItemCoreState } from "../core/ThreadListRuntimeCore";
import { BaseSubscribable } from "../remote-thread-list/BaseSubscribable";
import { LocalThreadRuntimeCore } from "./LocalThreadRuntimeCore";
import { generateId } from "../../internal"; // Assuming generateId is available
import { LocalRuntimeOptionsBase } from "./LocalRuntimeOptions"; // Import base options type
import { LocalStorageHistoryAdapter } from "./LocalStorageHistoryAdapter"; // Import the new adapter

// Factory now needs base options to pass through, excluding history which we provide
export type LocalThreadFactory = (
  threadId: string,
  options: LocalRuntimeOptionsBase
) => LocalThreadRuntimeCore;

// Helper functions for localStorage (implement these properly later)
const loadThreadsFromLocalStorage = (): {
  mainThreadId: string;
  threadIds: string[];
  archivedThreadIds: string[];
  threadMetadata: Record<string, Omit<ThreadListItemCoreState, "runtime">>;
} => {
  console.log("Attempting to load threads from localStorage...");
  // Placeholder: Return default structure if nothing found
  const defaultMainId = "__DEFAULT_ID__";
  return {
    mainThreadId: localStorage.getItem("assistant_mainThreadId") || defaultMainId,
    threadIds: JSON.parse(localStorage.getItem("assistant_threadIds") || '["__DEFAULT_ID__"]'),
    archivedThreadIds: JSON.parse(localStorage.getItem("assistant_archivedThreadIds") || "[]"),
    threadMetadata: JSON.parse(localStorage.getItem("assistant_threadMetadata") || '{}'),
  };
};

const saveThreadsToLocalStorage = (state: {
  mainThreadId: string;
  threadIds: readonly string[];
  archivedThreadIds: readonly string[];
  threadMetadata: Readonly<Record<string, Omit<ThreadListItemCoreState, "runtime">>>;
}) => {
  console.log("Saving threads to localStorage...", state);
  localStorage.setItem("assistant_mainThreadId", state.mainThreadId);
  localStorage.setItem("assistant_threadIds", JSON.stringify(state.threadIds));
  localStorage.setItem("assistant_archivedThreadIds", JSON.stringify(state.archivedThreadIds));
  localStorage.setItem("assistant_threadMetadata", JSON.stringify(state.threadMetadata));
};


const DEFAULT_THREAD_ID = "__DEFAULT_ID__";
const DEFAULT_THREAD_METADATA: Omit<ThreadListItemCoreState, "runtime"> = {
  threadId: DEFAULT_THREAD_ID,
  status: "regular",
  title: "Default Thread",
};

export class LocalThreadListRuntimeCore
  extends BaseSubscribable
  implements ThreadListRuntimeCore
{
  private _threadFactory: LocalThreadFactory;
  private _baseOptions: Omit<LocalRuntimeOptionsBase, 'history'>; // Store base options (without history)
  private _mainThreadId: string;
  private _threadIds: string[];
  private _archivedThreadIds: string[];
  private _threadMetadata: Record<string, Omit<ThreadListItemCoreState, "runtime">>;
  private _threadRuntimeInstances: Record<string, LocalThreadRuntimeCore> = {};
  private _loadThreadsPromise: Promise<void> | undefined;


  constructor(
    threadFactory: LocalThreadFactory,
    // Accept base options needed by the factory/runtimeCore
    baseOptions: Omit<LocalRuntimeOptionsBase, 'history'>
  ) {
    super();
    this._threadFactory = threadFactory;
    this._baseOptions = baseOptions; // Store them

    // Load initial state from localStorage
    const initialState = loadThreadsFromLocalStorage();
    this._mainThreadId = initialState.mainThreadId;
    this._threadIds = [...initialState.threadIds]; // Ensure mutable copy
    this._archivedThreadIds = [...initialState.archivedThreadIds]; // Ensure mutable copy
    this._threadMetadata = { ...initialState.threadMetadata }; // Ensure mutable copy

     // Ensure default thread metadata exists if loaded state is empty/corrupt
    if (!this._threadMetadata[DEFAULT_THREAD_ID] && !this._threadIds.includes(DEFAULT_THREAD_ID)) {
       if (!this._threadIds.includes(DEFAULT_THREAD_ID)) {
          this._threadIds.unshift(DEFAULT_THREAD_ID); // Add if missing
       }
       this._threadMetadata[DEFAULT_THREAD_ID] = DEFAULT_THREAD_METADATA;
       this._mainThreadId = DEFAULT_THREAD_ID; // Reset main if default was missing
       // Persist the corrected initial state immediately
       this.persistState();
    } else if (!this._threadMetadata[this._mainThreadId]) {
       // If mainThreadId points to non-existent metadata, reset to default
       this._mainThreadId = DEFAULT_THREAD_ID;
       if (!this._threadIds.includes(DEFAULT_THREAD_ID)) {
           this._threadIds.unshift(DEFAULT_THREAD_ID);
           this._threadMetadata[DEFAULT_THREAD_ID] = DEFAULT_THREAD_METADATA;
       }
       this.persistState();
    }


    console.log("Initialized LocalThreadListRuntimeCore state:", {
      mainThreadId: this._mainThreadId,
      threadIds: this._threadIds,
      archivedThreadIds: this._archivedThreadIds,
      threadMetadata: this._threadMetadata,
    });
    console.log("Base options received:", this._baseOptions);
  }

  private persistState() {
     saveThreadsToLocalStorage({
      mainThreadId: this._mainThreadId,
      threadIds: this._threadIds,
      archivedThreadIds: this._archivedThreadIds,
      threadMetadata: this._threadMetadata,
    });
     this._notifySubscribers();
  }

  private getOrCreateThreadRuntime(threadId: string): LocalThreadRuntimeCore {
    if (!this._threadRuntimeInstances[threadId]) {
       // Ensure metadata exists before creating runtime
       if (!this._threadMetadata[threadId]) {
          console.error(`Metadata missing for threadId: ${threadId}. Cannot create runtime.`);
          // Attempt to recover or handle error appropriately
          // For now, let's try creating default metadata if it's the default ID
          if (threadId === DEFAULT_THREAD_ID) {
             this._threadMetadata[DEFAULT_THREAD_ID] = DEFAULT_THREAD_METADATA;
             if (!this._threadIds.includes(DEFAULT_THREAD_ID)) {
                 this._threadIds.unshift(DEFAULT_THREAD_ID);
             }
             this.persistState();
          } else {
            // If it's not the default ID and metadata is missing, it's a more serious issue.
            // Maybe remove the inconsistent ID?
            this._threadIds = this._threadIds.filter(id => id !== threadId);
            this._archivedThreadIds = this._archivedThreadIds.filter(id => id !== threadId);
            this.persistState();
            throw new Error(`Cannot create runtime for thread ${threadId}: Missing metadata and not default thread.`);
          }
       }
      console.log(`Creating new LocalThreadRuntimeCore instance for thread: ${threadId}`);

      // Create the specific options for this thread's runtime instance
      const threadSpecificOptions: LocalRuntimeOptionsBase = {
          // Spread the base options (like chatModel)
          ...this._baseOptions,
          // Merge adapters, providing our specific history adapter
          adapters: {
              ...this._baseOptions.adapters,
              history: new LocalStorageHistoryAdapter(threadId),
          },
      };
      console.log(`Options passed to factory for thread ${threadId}:`, threadSpecificOptions);

      // Call the factory with the threadId and the combined options
      this._threadRuntimeInstances[threadId] = this._threadFactory(
          threadId,
          threadSpecificOptions
      );
    }
    return this._threadRuntimeInstances[threadId];
  }


  public getMainThreadRuntimeCore(): LocalThreadRuntimeCore {
     // Ensure the main thread runtime is created if it hasn't been already
     return this.getOrCreateThreadRuntime(this._mainThreadId);
  }

   // Represents the ID of a transient "new thread" state, if active
   // For local storage, we might not need a separate ID until it's initialized.
   // Let's return undefined for now, matching Remote impl.
  public get newThreadId(): string | undefined {
     // To implement "new thread" properly, we might create a temporary ID
     // or handle it via UI state before initialization.
    return undefined; // Or manage a specific transient ID if needed
  }

  public get threadIds(): readonly string[] {
     // Filter out the main thread if it's somehow in the archived list (shouldn't happen with proper logic)
     // and ensure the main thread is always first if it exists in the regular list
     const regularIds = this._threadIds.filter(id => !this._archivedThreadIds.includes(id) && id !== this._mainThreadId);
     // Ensure mainThreadId is always present and first, even if somehow missing from _threadIds initially
     const finalIds = [this._mainThreadId, ...regularIds];
     // Deduplicate just in case
    // return [...new Set(finalIds)];
    // Using a manual approach to avoid Set iteration issues
    const uniqueIds: string[] = [];
    for (const id of finalIds) {
      if (!uniqueIds.includes(id)) {
        uniqueIds.push(id);
      }
    }
    return Object.freeze(uniqueIds);
  }


  public get archivedThreadIds(): readonly string[] {
    return Object.freeze([...this._archivedThreadIds]);
  }


  public get mainThreadId(): string {
     // Ensure the main thread ID actually exists in our metadata
     if (!this._threadMetadata[this._mainThreadId]) {
         console.warn(`Main thread ID ${this._mainThreadId} not found in metadata, resetting to default.`);
         this._mainThreadId = DEFAULT_THREAD_ID;
         // Ensure default metadata exists
         if (!this._threadMetadata[DEFAULT_THREAD_ID]) {
             this._threadMetadata[DEFAULT_THREAD_ID] = DEFAULT_THREAD_METADATA;
         }
          // Ensure default ID is in the list
         if (!this._threadIds.includes(DEFAULT_THREAD_ID)) {
            this._threadIds.unshift(DEFAULT_THREAD_ID);
         }
         this._archivedThreadIds = this._archivedThreadIds.filter(id => id !== DEFAULT_THREAD_ID); // Remove from archived if present
         this.persistState();
     }
    return this._mainThreadId;
  }


  public getThreadRuntimeCore(threadId: string): LocalThreadRuntimeCore {
     if (!this._threadMetadata[threadId]) {
       throw new Error(`Thread with ID ${threadId} not found.`);
     }
     return this.getOrCreateThreadRuntime(threadId);
  }


  public getLoadThreadsPromise(): Promise<void> {
     // In this local implementation, loading happens synchronously in the constructor.
     // We return an already resolved promise.
     if (!this._loadThreadsPromise) {
       this._loadThreadsPromise = Promise.resolve();
       console.log("getLoadThreadsPromise called, returning resolved promise.");
     }
     return this._loadThreadsPromise;
  }


  public getItemById(threadId: string): ThreadListItemCoreState | undefined {
     const metadata = this._threadMetadata[threadId];
     if (!metadata) {
       return undefined;
     }
     // Runtime is lazily created when needed by getThreadRuntimeCore
     // We don't store it directly in the metadata state.
     return {
       ...metadata,
       runtime: undefined, // Or potentially fetch it: this.getOrCreateThreadRuntime(threadId) if needed immediately
     };
  }


  public async switchToThread(threadId: string): Promise<void> {
     if (this._mainThreadId === threadId) {
       console.log(`Already on thread ${threadId}. No switch needed.`);
       return; // No switch needed
     }
     if (!this._threadMetadata[threadId]) {
       throw new Error(`Thread ${threadId} not found, cannot switch.`);
     }


     // If switching to an archived thread, unarchive it first
     if (this._archivedThreadIds.includes(threadId)) {
         console.log(`Thread ${threadId} is archived. Unarchiving before switching.`);
         await this.unarchive(threadId); // unarchive already persists and notifies
     }


     console.log(`Switching main thread from ${this._mainThreadId} to ${threadId}`);
     this._mainThreadId = threadId;
     // Ensure the runtime instance is ready for the new main thread
     this.getOrCreateThreadRuntime(threadId);
     this.persistState(); // Persist the new mainThreadId and any potential unarchive changes
     // No need to notify again if unarchive already did
  }


  // Creates a new thread, initializes it, and switches to it.
  public async switchToNewThread(): Promise<void> {
     const newThreadId = generateId();
     console.log(`Creating and switching to new thread: ${newThreadId}`);


     // Initialize creates the metadata entry
     await this.initialize(newThreadId);


     // `initialize` adds to _threadIds and persists, now set as main
     this._mainThreadId = newThreadId;
     // Ensure runtime instance is created for the new thread
     this.getOrCreateThreadRuntime(newThreadId);


     this.persistState(); // Persist the new main thread ID
  }


  public async rename(threadId: string, newTitle: string): Promise<void> {
    if (!this._threadMetadata[threadId]) {
      throw new Error(`Thread ${threadId} not found, cannot rename.`);
    }
    console.log(`Renaming thread ${threadId} to "${newTitle}"`);
    this._threadMetadata[threadId] = {
      ...this._threadMetadata[threadId],
      title: newTitle,
    };
    this.persistState();
  }

  public async archive(threadId: string): Promise<void> {
    if (threadId === this._mainThreadId) {
      throw new Error("Cannot archive the main thread. Switch to another thread first.");
    }
    if (!this._threadMetadata[threadId]) {
      throw new Error(`Thread ${threadId} not found, cannot archive.`);
    }
    if (this._archivedThreadIds.includes(threadId)) {
      console.warn(`Thread ${threadId} is already archived.`);
      return; // Already archived
    }

    console.log(`Archiving thread ${threadId}`);
    this._threadMetadata[threadId] = {
      ...this._threadMetadata[threadId],
      status: "archived",
    };
    this._threadIds = this._threadIds.filter((id) => id !== threadId);
    this._archivedThreadIds.push(threadId);
    this.persistState();
  }

  public async unarchive(threadId: string): Promise<void> {
     if (!this._threadMetadata[threadId]) {
      throw new Error(`Thread ${threadId} not found, cannot unarchive.`);
    }
     const index = this._archivedThreadIds.indexOf(threadId);
     if (index === -1) {
       console.warn(`Thread ${threadId} is not archived.`);
       return; // Not archived
     }

     console.log(`Unarchiving thread ${threadId}`);
     this._threadMetadata[threadId] = {
       ...this._threadMetadata[threadId],
       status: "regular",
     };
     this._archivedThreadIds.splice(index, 1);
     if (!this._threadIds.includes(threadId)) {
       this._threadIds.push(threadId); // Add back to regular list
     }
     this.persistState();
  }

  public async delete(threadId: string): Promise<void> {
     if (threadId === this._mainThreadId) {
       throw new Error("Cannot delete the main thread. Switch to another thread first.");
     }
     if (!this._threadMetadata[threadId]) {
       console.warn(`Thread ${threadId} not found, cannot delete.`);
       return; // Not found, nothing to delete
     }

     console.log(`Deleting thread ${threadId}`);
     delete this._threadMetadata[threadId];
     this._threadIds = this._threadIds.filter((id) => id !== threadId);
     this._archivedThreadIds = this._archivedThreadIds.filter((id) => id !== threadId);

     // Also delete associated messages from localStorage
     try {
       localStorage.removeItem(`assistant-thread-${threadId}-messages`);
       console.log(`Removed messages for deleted thread ${threadId} from localStorage.`);
     } catch (e) {
        console.error(`Failed to remove messages for thread ${threadId} from localStorage:`, e);
     }


     this.persistState();
  }

   // Initializes a thread, usually means creating its initial state/metadata.
   // In the local context, this means adding it to our tracked lists.
  public async initialize(threadId: string): Promise<{ remoteId: string; externalId: string | undefined; }> {
     if (this._threadMetadata[threadId]) {
       console.warn(`Thread ${threadId} already initialized.`);
       // Return existing identifiers if needed, although local doesn't really have remote/external IDs
        return { remoteId: threadId, externalId: undefined };
     }


     console.log(`Initializing new thread ${threadId}`);
     this._threadMetadata[threadId] = {
        threadId: threadId,
        status: "regular", // Start as regular
        title: "New Thread", // Default title
     };


     // Add to the list of regular threads if not already there
     if (!this._threadIds.includes(threadId)) {
        this._threadIds.push(threadId);
     }
     // Ensure it's not in archived list
     this._archivedThreadIds = this._archivedThreadIds.filter(id => id !== threadId);


     this.persistState();


     // For local, remoteId is just the threadId itself
     return { remoteId: threadId, externalId: undefined };
  }

  // Generate title is often an AI call. We'll make it a simple placeholder for local.
  public async generateTitle(threadId: string): Promise<void> {
     if (!this._threadMetadata[threadId]) {
       throw new Error(`Thread ${threadId} not found, cannot generate title.`);
     }
     // Simple placeholder logic:
     const currentTitle = this._threadMetadata[threadId].title;
     if (!currentTitle || currentTitle === "New Thread") {
        const newTitle = `Thread ${threadId.substring(0, 5)}`; // Simple generated title
        console.log(`Generating title for thread ${threadId}: "${newTitle}" (placeholder)`);
        await this.rename(threadId, newTitle); // Use rename to update and persist
     } else {
        console.log(`Thread ${threadId} already has a title: "${currentTitle}". Skipping title generation.`);
     }
  }
}
