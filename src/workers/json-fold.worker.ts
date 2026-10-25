import { indexJsonFolds } from "../services/json-fold-index";
import type {
  FoldIndexRequest,
  FoldIndexReply,
} from "../services/json-fold-index";
const scope = self as unknown as {
  onmessage: (event: MessageEvent<FoldIndexRequest>) => void;
  postMessage: (reply: FoldIndexReply, transfer: Transferable[]) => void;
};
scope.onmessage = ({ data }) => {
  const ranges = indexJsonFolds(data.source);
  scope.postMessage({ revision: data.revision, ranges }, [ranges.buffer]);
};
