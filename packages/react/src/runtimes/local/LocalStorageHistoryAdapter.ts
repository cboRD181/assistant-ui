import { ExportedMessageRepository } from "../utils/MessageRepository";
import { ThreadMessage } from "../../types";
import { ThreadHistoryAdapter } from "../adapters/thread-history/ThreadHistoryAdapter";

// Define the shape of the data we'll store for each thread's history
interface LocalStorageThreadHistory {
  messages: Array<{ message: ThreadMessage; parentId: string | null }>;
  headId?: string | null;
  // unstable_resume?: any;
}

const HISTORY_STORAGE_KEY_PREFIX = "assistant-thread-";
const HISTORY_STORAGE_KEY_SUFFIX = "-messages";

export class LocalStorageHistoryAdapter implements ThreadHistoryAdapter {
  private threadId: string;
  private storageKey: string;

  constructor(threadId: string) {
    if (!threadId) {
      throw new Error("LocalStorageHistoryAdapter requires a valid threadId.");
    }
    this.threadId = threadId;
    this.storageKey = `${HISTORY_STORAGE_KEY_PREFIX}${threadId}${HISTORY_STORAGE_KEY_SUFFIX}`;
    console.log(`LocalStorageHistoryAdapter initialized for thread: ${threadId}, key: ${this.storageKey}`);
  }

  async load(): Promise<ExportedMessageRepository | null> {
    console.log(`Attempting to load history for thread ${this.threadId} from key ${this.storageKey}`);
    try {
      const storedData = localStorage.getItem(this.storageKey);
      if (storedData) {
        const parsedData: LocalStorageThreadHistory = JSON.parse(storedData);
        console.log(`Successfully loaded and parsed history for thread ${this.threadId}`);

        // Rehydrate Date objects - create new objects instead of modifying readonly properties
        const rehydratedMessages = parsedData.messages.map(({ message, parentId }) => {
            let createdAt = message.createdAt;
            if (createdAt && typeof createdAt === 'string') {
                createdAt = new Date(createdAt);
            }
            // Create a new message object with potentially updated createdAt
            const rehydratedMessage: ThreadMessage = {
                ...message,
                createdAt: createdAt as Date, // Assert type after check
            };
            return { message: rehydratedMessage, parentId };
        });

        const finalData: ExportedMessageRepository = {
          messages: rehydratedMessages,
          headId: parsedData.headId,
        };

        return finalData;
      } else {
        console.log(`No history found in localStorage for thread ${this.threadId}`);
        return null; // No history saved yet
      }
    } catch (error) {
      console.error(`Error loading history for thread ${this.threadId} from localStorage:`, error);
      return null; // Return null on error
    }
  }

  // Append/update should now trigger saving the full history provided by LocalThreadRuntimeCore
  async append(change: { parentId: string | null; message: ThreadMessage }): Promise<void> {
    // This method might not need to do anything if saveFullHistory is called externally
    console.log(`LocalStorageHistoryAdapter: append called for thread ${this.threadId}. Relying on external saveFullHistory call.`);
    // Optionally, could trigger a save here if needed, but requires access to the repo state.
    // await this.saveFullHistory( /* need repository data here */ );
  }

  async update(message: ThreadMessage): Promise<void> {
    // This method might not need to do anything if saveFullHistory is called externally
    console.log(`LocalStorageHistoryAdapter: update called for thread ${this.threadId}. Relying on external saveFullHistory call.`);
    // await this.saveFullHistory( /* need repository data here */ );
  }

  // This method is intended to be called BY LocalThreadRuntimeCore whenever history changes
  async saveFullHistory(repositoryData?: ExportedMessageRepository): Promise<void> {
      if (!repositoryData) {
          console.warn(`saveFullHistory called without repositoryData for thread ${this.threadId}. Cannot save.`);
          return;
      }

      console.log(`Saving full history for thread ${this.threadId} to key ${this.storageKey}`);
      try {
        // Prepare data for storage - ensure it matches LocalStorageThreadHistory
        const dataToStore: LocalStorageThreadHistory = {
          messages: repositoryData.messages, // Already in the correct shape
          headId: repositoryData.headId,
        };

        // Handle potential circular references or large objects if necessary
        const serializedData = JSON.stringify(dataToStore);
        localStorage.setItem(this.storageKey, serializedData);
        console.log(`Successfully saved history for thread ${this.threadId}`);
      } catch (error) {
        console.error(`Error saving history for thread ${this.threadId} to localStorage:`, error);
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            console.error("LocalStorage quota exceeded! History may not be fully saved.");
            // Implement more robust error handling / user notification here
        }
      }
  }

  // --- Optional/Advanced Methods (Keep commented out for now) --- 

  // async resume(data: any): Promise<void> { ... }

} 