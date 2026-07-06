-- Named entities extracted by GPT per article (spec §5.3 entities.people/
-- orgs/locations). Previously only entities.locations was used (geocoding)
-- and people/orgs were discarded — meaning there was no way for two
-- articles that both mention the same person/org to be linked. This table
-- persists all three so relate.js can use shared people/orgs as a relation
-- signal alongside embedding similarity.

CREATE TABLE article_entities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id  TEXT NOT NULL REFERENCES articles(id),
  entity_type TEXT NOT NULL,   -- 'person' | 'org' | 'location'
  entity_name TEXT NOT NULL
);

CREATE INDEX idx_article_entities_article ON article_entities(article_id);
CREATE INDEX idx_article_entities_name ON article_entities(entity_name);
