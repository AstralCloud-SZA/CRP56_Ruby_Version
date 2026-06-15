# frozen_string_literal: true

require "json"
require "securerandom"
require "fileutils"

module CRP56
  ##
  # PhraseStore manages the phrase slots used by the CRP56 key-derivation
  # layer.
  #
  # The store keeps a fixed number of named phrase slots, loads them from JSON,
  # validates that each slot exists and is non-empty, and provides helpers for
  # saving, random slot selection, and slot access by index.
  #
  # Expected JSON shape:
  # {
  #   "slot_0": "phrase one",
  #   "slot_1": "phrase two",
  #   ...
  # }
  #
  # The store can be loaded from disk or created from in-memory data, and it is
  # used by the crypto layer to choose a base phrase for encryption and
  # decryption.
  class PhraseStore
    attr_reader :phrases, :source_path

    ##
    # Creates a new phrase store.
    #
    # If +phrases+ is nil, the store is initialized with empty default slots.
    # If +source_path+ is provided, it records where the store came from.
    def initialize(phrases = nil, source_path: nil)
      @phrases = normalize_phrases(phrases || default_phrase_hash)
      @source_path = source_path
    end

    # ─── Class methods ──────────────────────────────────────────────────────────

    ##
    # Loads a phrase store from a JSON file on disk.
    #
    # @param path [String] path to a phrase store JSON file
    # @return [PhraseStore] loaded store instance
    # @raise [PhraseStoreError] if the file is missing or invalid
    def self.load(path)
      raise PhraseStoreError, "Phrase store path cannot be nil or empty." if blank_path?(path)
      raise PhraseStoreError, "Phrase store file not found: #{path}" unless File.exist?(path)

      raw = File.read(path, encoding: "UTF-8")
      data = JSON.parse(raw)

      new(data, source_path: path)
    rescue JSON::ParserError => e
      raise PhraseStoreError, "Failed to parse phrase store JSON: #{e.message}"
    end

    ##
    # Returns true if a path points to a readable and valid phrase store file.
    def self.valid_path?(path)
      return false if blank_path?(path)
      return false unless File.exist?(path) && File.file?(path)

      begin
        load(path).valid?
      rescue PhraseStoreError, StandardError
        false
      end
    end

    # ─── Instance methods ────────────────────────────────────────────────────────

    ##
    # Saves the current phrase store to a JSON file.
    #
    # @param path [String] destination file path
    # @raise [PhraseStoreError] if the path is invalid
    def save(path)
      raise PhraseStoreError, "Phrase store path cannot be nil or empty." if self.class.send(:blank_path?, path)

      dir = File.dirname(path)
      FileUtils.mkdir_p(dir) unless Dir.exist?(dir)

      File.write(path, JSON.pretty_generate(@phrases), encoding: "UTF-8")
      @source_path = path
    end

    ##
    # Returns true if the store has exactly the required slots and all phrases
    # are present and non-empty.
    def valid?
      return false unless phrases.is_a?(Hash)
      return false unless phrases.keys.sort == expected_keys.sort

      expected_keys.all? do |key|
        value = phrases[key]
        value.is_a?(String) && !value.strip.empty?
      end
    end

    ##
    # Raises an error unless the store is valid.
    def validate!
      return true if valid?

      raise PhraseStoreError,
            "Phrase store is invalid. Exactly #{Constants::KEY_PHRASE_SLOTS} non-empty phrases are required."
    end

    ##
    # Returns the phrase stored at a given slot index.
    #
    # @param slot_index [Integer] slot number from 0 to KEY_PHRASE_SLOTS - 1
    def get_phrase(slot_index)
      validate_slot_index!(slot_index)

      value = phrases[slot_key(slot_index)]
      if value.nil? || value.strip.empty?
        raise PhraseStoreError, "Phrase slot #{slot_index} is empty or missing."
      end

      value
    end

    ##
    # Updates a phrase slot with a new non-empty phrase.
    def set_phrase(slot_index, phrase)
      validate_slot_index!(slot_index)

      if phrase.nil? || phrase.strip.empty?
        raise PhraseStoreError, "Phrase cannot be nil or empty."
      end

      phrases[slot_key(slot_index)] = phrase
    end

    ##
    # Picks a random valid slot index for encryption.
    def random_slot_picker
      SecureRandom.random_number(Constants::KEY_PHRASE_SLOTS)
    end

    ##
    # Returns the phrases as an ordered array from slot_0 upward.
    def to_a
      (0...Constants::KEY_PHRASE_SLOTS).map { |index| get_phrase(index) }
    end

    ##
    # Returns a shallow copy of the underlying phrase hash.
    def to_h
      @phrases.dup
    end

    ##
    # Returns a simple source indicator for the store.
    def source
      @source_path ? :file : :unknown
    end

    # ─── Private ─────────────────────────────────────────────────────────────────

    private

    ##
    # Normalizes incoming phrase keys into the canonical slot_* shape.
    def normalize_phrases(input)
      normalized = default_phrase_hash

      input.each do |key, value|
        normalized_key = normalize_key(key)
        normalized[normalized_key] = value if normalized.key?(normalized_key)
      end

      normalized
    end

    ##
    # Builds the default empty slot hash.
    def default_phrase_hash
      (0...Constants::KEY_PHRASE_SLOTS).each_with_object({}) do |index, hash|
        hash[slot_key(index)] = ""
      end
    end

    ##
    # Returns the list of expected canonical keys.
    def expected_keys
      (0...Constants::KEY_PHRASE_SLOTS).map { |index| slot_key(index) }
    end

    ##
    # Converts an index into the canonical slot key string.
    def slot_key(index)
      "slot_#{index}"
    end

    ##
    # Normalizes user-provided keys into canonical slot keys when possible.
    def normalize_key(key)
      string_key = key.to_s.strip

      # Already a valid slot key for any slot count
      return string_key if string_key.match?(/\Aslot_\d+\z/)

      # Plain integer string — convert to slot key
      return slot_key(string_key.to_i) if string_key.match?(/\A\d+\z/)

      string_key
    end

    ##
    # Ensures the slot index is in range.
    def validate_slot_index!(slot_index)
      unless slot_index.is_a?(Integer) && slot_index >= 0 && slot_index < Constants::KEY_PHRASE_SLOTS
        raise PhraseStoreError, "Invalid slot index #{slot_index.inspect}. " \
          "Must be between 0 and #{Constants::KEY_PHRASE_SLOTS - 1}."
      end
    end

    ##
    # Checks whether a path-like value is blank.
    def self.blank_path?(path)
      path.nil? || path.to_s.strip.empty?
    end

    private_class_method :blank_path?
  end
end