function sorted(values) {
  return [...values].sort();
}

function sourceIds(index) {
  return new Set((Array.isArray(index.sources) ? index.sources : []).map((source) => source.source).filter(Boolean));
}

function topicMap(index) {
  return new Map((Array.isArray(index.topics) ? index.topics : []).map((topic) => [topic.topic_key, topic]).filter(([key]) => key));
}

function sourceRefCount(index) {
  return (Array.isArray(index.topics) ? index.topics : []).reduce(
    (sum, topic) => sum + (Array.isArray(topic.retrieved_sources) ? topic.retrieved_sources.length : 0),
    0,
  );
}

function comparableTopic(topic) {
  return {
    topic_label: topic.topic_label ?? null,
    mapping_status: topic.mapping_status ?? null,
    aliases: sorted(Array.isArray(topic.aliases) ? topic.aliases : []),
    keywords: sorted(Array.isArray(topic.keywords) ? topic.keywords : []),
    retrieved_sources: (Array.isArray(topic.retrieved_sources) ? topic.retrieved_sources : [])
      .map((source) => ({
        source: source.source ?? null,
        topic_id: source.topic_id ?? null,
        normalized_id: source.normalized_id ?? null,
        source_version: source.source_version ?? null,
        license: source.license ?? null,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function sameTopic(left, right) {
  return JSON.stringify(comparableTopic(left)) === JSON.stringify(comparableTopic(right));
}

function setAdded(fromSet, toSet) {
  return sorted([...toSet].filter((value) => !fromSet.has(value)));
}

function setRemoved(fromSet, toSet) {
  return sorted([...fromSet].filter((value) => !toSet.has(value)));
}

export function diffRuntimeIndexes(fromIndex, toIndex) {
  const fromSources = sourceIds(fromIndex);
  const toSources = sourceIds(toIndex);
  const fromTopics = topicMap(fromIndex);
  const toTopics = topicMap(toIndex);
  const addedTopics = setAdded(new Set(fromTopics.keys()), new Set(toTopics.keys()));
  const removedTopics = setRemoved(new Set(fromTopics.keys()), new Set(toTopics.keys()));
  const changedTopics = sorted(
    [...toTopics.keys()].filter(
      (topicKey) => fromTopics.has(topicKey) && !sameTopic(fromTopics.get(topicKey), toTopics.get(topicKey)),
    ),
  );

  return {
    summary: {
      source_count_delta: toSources.size - fromSources.size,
      topic_count_delta: toTopics.size - fromTopics.size,
      source_ref_count_delta: sourceRefCount(toIndex) - sourceRefCount(fromIndex),
    },
    topics: {
      added: addedTopics,
      removed: removedTopics,
      changed: changedTopics,
    },
    sources: {
      added: setAdded(fromSources, toSources),
      removed: setRemoved(fromSources, toSources),
    },
  };
}
