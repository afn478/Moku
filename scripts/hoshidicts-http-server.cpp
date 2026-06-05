#include <algorithm>
#include <cctype>
#include <charconv>
#include <filesystem>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <ranges>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "hoshidicts/deinflector.hpp"
#include "hoshidicts/importer.hpp"
#include "hoshidicts/lookup.hpp"
#include "hoshidicts/query.hpp"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
using socket_t = SOCKET;
constexpr socket_t invalid_socket_value = INVALID_SOCKET;
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
constexpr socket_t invalid_socket_value = -1;
#endif

namespace fs = std::filesystem;

namespace {

struct HttpRequest {
  std::string method;
  std::string target;
  std::string path;
  std::string query;
  std::unordered_map<std::string, std::string> headers;
  std::string body;
};

struct HttpResponse {
  int status = 200;
  std::string status_text = "OK";
  std::string content_type = "application/json; charset=utf-8";
  std::string body = "{}";
};

std::string to_lower(std::string value) {
  std::ranges::transform(value, value.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
  return value;
}

std::string trim(std::string_view value) {
  size_t start = 0;
  while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start]))) start++;
  size_t end = value.size();
  while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1]))) end--;
  return std::string(value.substr(start, end - start));
}

bool starts_with(std::string_view value, std::string_view prefix) {
  return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

std::string json_escape(std::string_view value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (ch < 0x20) {
          const char* hex = "0123456789abcdef";
          out += "\\u00";
          out += hex[(ch >> 4) & 0x0f];
          out += hex[ch & 0x0f];
        } else {
          out.push_back(static_cast<char>(ch));
        }
    }
  }
  return out;
}

std::string quoted(std::string_view value) {
  return "\"" + json_escape(value) + "\"";
}

std::string path_utf8(const fs::path& path) {
  const auto value = path.u8string();
  return std::string(reinterpret_cast<const char*>(value.data()), value.size());
}

std::string percent_decode(std::string_view value) {
  std::string out;
  out.reserve(value.size());
  for (size_t i = 0; i < value.size(); i++) {
    const char ch = value[i];
    if (ch == '+') {
      out.push_back(' ');
      continue;
    }
    if (ch == '%' && i + 2 < value.size()) {
      const auto hex = value.substr(i + 1, 2);
      int decoded = 0;
      const auto result = std::from_chars(hex.data(), hex.data() + hex.size(), decoded, 16);
      if (result.ec == std::errc{}) {
        out.push_back(static_cast<char>(decoded));
        i += 2;
        continue;
      }
    }
    out.push_back(ch);
  }
  return out;
}

std::unordered_map<std::string, std::string> parse_query(std::string_view query) {
  std::unordered_map<std::string, std::string> out;
  size_t pos = 0;
  while (pos <= query.size()) {
    const size_t amp = query.find('&', pos);
    const auto part = query.substr(pos, amp == std::string_view::npos ? query.size() - pos : amp - pos);
    const size_t eq = part.find('=');
    if (eq != std::string_view::npos) {
      out[percent_decode(part.substr(0, eq))] = percent_decode(part.substr(eq + 1));
    } else if (!part.empty()) {
      out[percent_decode(part)] = "";
    }
    if (amp == std::string_view::npos) break;
    pos = amp + 1;
  }
  return out;
}

std::optional<std::string> parse_json_string_field(std::string_view body, std::string_view key) {
  const std::string needle = "\"" + std::string(key) + "\"";
  const size_t key_pos = body.find(needle);
  if (key_pos == std::string_view::npos) return std::nullopt;
  const size_t colon = body.find(':', key_pos + needle.size());
  if (colon == std::string_view::npos) return std::nullopt;
  size_t pos = colon + 1;
  while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) pos++;
  if (pos >= body.size() || body[pos] != '"') return std::nullopt;
  pos++;

  std::string out;
  while (pos < body.size()) {
    const char ch = body[pos++];
    if (ch == '"') return out;
    if (ch != '\\' || pos >= body.size()) {
      out.push_back(ch);
      continue;
    }
    const char escaped = body[pos++];
    switch (escaped) {
      case '"': out.push_back('"'); break;
      case '\\': out.push_back('\\'); break;
      case '/': out.push_back('/'); break;
      case 'b': out.push_back('\b'); break;
      case 'f': out.push_back('\f'); break;
      case 'n': out.push_back('\n'); break;
      case 'r': out.push_back('\r'); break;
      case 't': out.push_back('\t'); break;
      default: out.push_back(escaped); break;
    }
  }
  return std::nullopt;
}

std::optional<int> parse_json_int_field(std::string_view body, std::string_view key) {
  const std::string needle = "\"" + std::string(key) + "\"";
  const size_t key_pos = body.find(needle);
  if (key_pos == std::string_view::npos) return std::nullopt;
  const size_t colon = body.find(':', key_pos + needle.size());
  if (colon == std::string_view::npos) return std::nullopt;
  size_t pos = colon + 1;
  while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) pos++;
  const size_t start = pos;
  if (pos < body.size() && body[pos] == '-') pos++;
  while (pos < body.size() && std::isdigit(static_cast<unsigned char>(body[pos]))) pos++;
  if (pos == start) return std::nullopt;
  int value = 0;
  const auto text = body.substr(start, pos - start);
  const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
  if (result.ec != std::errc{}) return std::nullopt;
  return value;
}

std::optional<bool> parse_json_bool_field(std::string_view body, std::string_view key) {
  const std::string needle = "\"" + std::string(key) + "\"";
  const size_t key_pos = body.find(needle);
  if (key_pos == std::string_view::npos) return std::nullopt;
  const size_t colon = body.find(':', key_pos + needle.size());
  if (colon == std::string_view::npos) return std::nullopt;
  size_t pos = colon + 1;
  while (pos < body.size() && std::isspace(static_cast<unsigned char>(body[pos]))) pos++;
  if (body.substr(pos, 4) == "true") return true;
  if (body.substr(pos, 5) == "false") return false;
  return std::nullopt;
}

std::string string_param(const HttpRequest& request, const std::unordered_map<std::string, std::string>& query,
                         std::string_view key, std::string fallback = "") {
  if (auto parsed = parse_json_string_field(request.body, key)) return *parsed;
  if (auto found = query.find(std::string(key)); found != query.end()) return found->second;
  return fallback;
}

int int_param(const HttpRequest& request, const std::unordered_map<std::string, std::string>& query,
              std::string_view key, int fallback) {
  if (auto parsed = parse_json_int_field(request.body, key)) return *parsed;
  if (auto found = query.find(std::string(key)); found != query.end()) {
    int value = fallback;
    const auto result = std::from_chars(found->second.data(), found->second.data() + found->second.size(), value);
    if (result.ec == std::errc{}) return value;
  }
  return fallback;
}

bool bool_param(const HttpRequest& request, std::string_view key, bool fallback) {
  return parse_json_bool_field(request.body, key).value_or(fallback);
}

std::string glossary_to_json(const GlossaryEntry& glossary) {
  std::ostringstream out;
  out << "{";
  out << "\"dictName\":" << quoted(glossary.dict_name) << ",";
  out << "\"glossary\":" << quoted(glossary.glossary) << ",";
  out << "\"definitionTags\":" << quoted(glossary.definition_tags) << ",";
  out << "\"termTags\":" << quoted(glossary.term_tags);
  out << "}";
  return out.str();
}

std::string frequency_to_json(const FrequencyEntry& entry) {
  std::ostringstream out;
  out << "{\"dictName\":" << quoted(entry.dict_name) << ",\"frequencies\":[";
  for (size_t i = 0; i < entry.frequencies.size(); i++) {
    const auto& frequency = entry.frequencies[i];
    if (i) out << ",";
    out << "{\"value\":" << frequency.value << ",\"displayValue\":" << quoted(frequency.display_value) << "}";
  }
  out << "]}";
  return out.str();
}

std::string pitch_to_json(const PitchEntry& entry) {
  std::ostringstream out;
  out << "{\"dictName\":" << quoted(entry.dict_name) << ",\"pitchPositions\":[";
  for (size_t i = 0; i < entry.pitch_positions.size(); i++) {
    if (i) out << ",";
    out << entry.pitch_positions[i];
  }
  out << "]}";
  return out.str();
}

std::string lookup_result_to_json(const LookupResult& result) {
  std::ostringstream out;
  out << "{";
  out << "\"matched\":" << quoted(result.matched) << ",";
  out << "\"deinflected\":" << quoted(result.deinflected) << ",";
  out << "\"process\":[";
  for (size_t i = 0; i < result.trace.size(); i++) {
    if (i) out << ",";
    out << "{\"name\":" << quoted(result.trace[i].name) << ",\"description\":" << quoted(result.trace[i].description) << "}";
  }
  out << "],";
  out << "\"term\":{";
  out << "\"expression\":" << quoted(result.term.expression) << ",";
  out << "\"reading\":" << quoted(result.term.reading) << ",";
  out << "\"rules\":" << quoted(result.term.rules) << ",";
  out << "\"glossaries\":[";
  for (size_t i = 0; i < result.term.glossaries.size(); i++) {
    if (i) out << ",";
    out << glossary_to_json(result.term.glossaries[i]);
  }
  out << "],\"frequencies\":[";
  for (size_t i = 0; i < result.term.frequencies.size(); i++) {
    if (i) out << ",";
    out << frequency_to_json(result.term.frequencies[i]);
  }
  out << "],\"pitches\":[";
  for (size_t i = 0; i < result.term.pitches.size(); i++) {
    if (i) out << ",";
    out << pitch_to_json(result.term.pitches[i]);
  }
  out << "]},";
  out << "\"preprocessorSteps\":" << result.preprocessor_steps;
  out << "}";
  return out.str();
}

bool is_imported_dictionary(const fs::path& path) {
  return fs::is_directory(path) && fs::exists(path / ".hoshidicts_1") && fs::exists(path / "index.json");
}

std::vector<fs::path> scan_dictionary_paths(const fs::path& root) {
  std::vector<fs::path> paths;
  if (!fs::is_directory(root)) return paths;
  for (const auto& entry : fs::directory_iterator(root)) {
    if (is_imported_dictionary(entry.path())) paths.push_back(entry.path());
  }
  std::ranges::sort(paths);
  return paths;
}

std::string path_json_array(const std::vector<fs::path>& paths) {
  std::ostringstream out;
  out << "[";
  for (size_t i = 0; i < paths.size(); i++) {
    if (i) out << ",";
    out << quoted(path_utf8(paths[i].filename()));
  }
  out << "]";
  return out.str();
}

struct DictionaryServerState {
  fs::path data_root;
  std::string language = "ja";
  std::vector<fs::path> term_paths;
  std::vector<fs::path> freq_paths;
  std::vector<fs::path> pitch_paths;
  std::unique_ptr<DictionaryQuery> query;
  std::unique_ptr<Deinflector> deinflector;
  std::unique_ptr<Lookup> lookup;
  std::vector<std::string> load_errors;
  std::mutex mutex;

  void ensure_directories() const {
    fs::create_directories(data_root / "Term");
    fs::create_directories(data_root / "Frequency");
    fs::create_directories(data_root / "Pitch");
  }

  void reload() {
    ensure_directories();

    auto next_query = std::make_unique<DictionaryQuery>();
    auto next_deinflector = std::make_unique<Deinflector>(language);
    std::vector<std::string> next_errors;

    auto next_term_paths = scan_dictionary_paths(data_root / "Term");
    auto next_freq_paths = scan_dictionary_paths(data_root / "Frequency");
    auto next_pitch_paths = scan_dictionary_paths(data_root / "Pitch");

    for (const auto& path : next_term_paths) {
      try {
        next_query->add_term_dict(path_utf8(path));
      } catch (const std::exception& err) {
        next_errors.push_back("term " + path_utf8(path.filename()) + ": " + err.what());
      }
    }
    for (const auto& path : next_freq_paths) {
      try {
        next_query->add_freq_dict(path_utf8(path));
      } catch (const std::exception& err) {
        next_errors.push_back("frequency " + path_utf8(path.filename()) + ": " + err.what());
      }
    }
    for (const auto& path : next_pitch_paths) {
      try {
        next_query->add_pitch_dict(path_utf8(path));
      } catch (const std::exception& err) {
        next_errors.push_back("pitch " + path_utf8(path.filename()) + ": " + err.what());
      }
    }

    auto next_lookup = std::make_unique<Lookup>(*next_query, *next_deinflector);

    std::lock_guard lock(mutex);
    term_paths = std::move(next_term_paths);
    freq_paths = std::move(next_freq_paths);
    pitch_paths = std::move(next_pitch_paths);
    load_errors = std::move(next_errors);
    query = std::move(next_query);
    deinflector = std::move(next_deinflector);
    lookup = std::move(next_lookup);
  }

  std::vector<LookupResult> lookup_text(const std::string& text, int max_results, int scan_length,
                                        const std::string& lookup_language) {
    std::lock_guard lock(mutex);
    if (!lookup || !deinflector) return {};
    deinflector->set_language(lookup_language.empty() ? language : lookup_language);
    return lookup->lookup(text, std::max(1, std::min(max_results, 50)), static_cast<size_t>(std::max(1, std::min(scan_length, 64))));
  }

  ImportResult import_dictionary(const std::string& zip_path, const std::string& type, bool low_ram) {
    const auto normalized_type = to_lower(type);
    fs::path output_dir = data_root / "Term";
    if (normalized_type == "frequency" || normalized_type == "freq") output_dir = data_root / "Frequency";
    if (normalized_type == "pitch") output_dir = data_root / "Pitch";
    fs::create_directories(output_dir);
    auto result = dictionary_importer::import(zip_path, path_utf8(output_dir), low_ram);
    reload();
    return result;
  }

  std::string status_json() const {
    std::ostringstream out;
    out << "{";
    out << "\"status\":\"running\",";
    out << "\"language\":" << quoted(language) << ",";
    out << "\"dataRoot\":" << quoted(path_utf8(data_root)) << ",";
    out << "\"termDictionaries\":" << path_json_array(term_paths) << ",";
    out << "\"frequencyDictionaries\":" << path_json_array(freq_paths) << ",";
    out << "\"pitchDictionaries\":" << path_json_array(pitch_paths) << ",";
    out << "\"errors\":[";
    for (size_t i = 0; i < load_errors.size(); i++) {
      if (i) out << ",";
      out << quoted(load_errors[i]);
    }
    out << "]}";
    return out.str();
  }
};

HttpResponse json_response(std::string body, int status = 200, std::string status_text = "OK") {
  return HttpResponse{status, std::move(status_text), "application/json; charset=utf-8", std::move(body)};
}

HttpResponse route_request(DictionaryServerState& state, const HttpRequest& request) {
  const auto query = parse_query(request.query);

  if (request.method == "OPTIONS") {
    return HttpResponse{204, "No Content", "application/json; charset=utf-8", ""};
  }

  if (request.path == "/") {
    std::lock_guard lock(state.mutex);
    return json_response(state.status_json());
  }

  if (request.path == "/reload") {
    state.reload();
    std::lock_guard lock(state.mutex);
    return json_response(state.status_json());
  }

  if (request.path == "/lookup") {
    const std::string text = trim(string_param(request, query, "text"));
    if (text.empty()) return json_response("{\"results\":[]}");

    const int max_results = int_param(request, query, "maxResults", 16);
    const int scan_length = int_param(request, query, "scanLength", 16);
    const std::string language = string_param(request, query, "language", "ja");
    const auto results = state.lookup_text(text, max_results, scan_length, language);

    std::ostringstream out;
    out << "{\"results\":[";
    for (size_t i = 0; i < results.size(); i++) {
      if (i) out << ",";
      out << lookup_result_to_json(results[i]);
    }
    out << "]}";
    return json_response(out.str());
  }

  if (request.path == "/import") {
    const std::string zip_path = string_param(request, query, "zipPath");
    if (zip_path.empty()) return json_response("{\"success\":false,\"errors\":[\"zipPath is required\"]}", 400, "Bad Request");
    const std::string type = string_param(request, query, "type", "term");
    const bool low_ram = bool_param(request, "lowRam", false);
    const auto result = state.import_dictionary(zip_path, type, low_ram);

    std::ostringstream out;
    out << "{";
    out << "\"success\":" << (result.success ? "true" : "false") << ",";
    out << "\"title\":" << quoted(result.title) << ",";
    out << "\"termCount\":" << result.term_count << ",";
    out << "\"metaCount\":" << result.meta_count << ",";
    out << "\"freqCount\":" << result.freq_count << ",";
    out << "\"pitchCount\":" << result.pitch_count << ",";
    out << "\"mediaCount\":" << result.media_count << ",";
    out << "\"errors\":[";
    for (size_t i = 0; i < result.errors.size(); i++) {
      if (i) out << ",";
      out << quoted(result.errors[i]);
    }
    out << "]}";
    return json_response(out.str(), result.success ? 200 : 500, result.success ? "OK" : "Import Failed");
  }

  return json_response("{\"error\":\"not found\"}", 404, "Not Found");
}

bool socket_startup() {
#ifdef _WIN32
  WSADATA data{};
  return WSAStartup(MAKEWORD(2, 2), &data) == 0;
#else
  return true;
#endif
}

void socket_cleanup() {
#ifdef _WIN32
  WSACleanup();
#endif
}

void close_socket(socket_t socket) {
#ifdef _WIN32
  closesocket(socket);
#else
  close(socket);
#endif
}

int recv_socket(socket_t socket, char* buffer, int length) {
#ifdef _WIN32
  return recv(socket, buffer, length, 0);
#else
  return static_cast<int>(recv(socket, buffer, static_cast<size_t>(length), 0));
#endif
}

int send_socket(socket_t socket, const char* buffer, int length) {
#ifdef _WIN32
  return send(socket, buffer, length, 0);
#else
  return static_cast<int>(send(socket, buffer, static_cast<size_t>(length), 0));
#endif
}

std::optional<HttpRequest> read_request(socket_t client) {
  std::string raw;
  char buffer[4096];
  size_t header_end = std::string::npos;
  size_t content_length = 0;

  while (true) {
    const int received = recv_socket(client, buffer, sizeof(buffer));
    if (received <= 0) return std::nullopt;
    raw.append(buffer, static_cast<size_t>(received));

    if (header_end == std::string::npos) {
      header_end = raw.find("\r\n\r\n");
      if (header_end != std::string::npos) {
        const std::string headers_text = raw.substr(0, header_end);
        std::istringstream header_stream(headers_text);
        std::string line;
        std::getline(header_stream, line);
        while (std::getline(header_stream, line)) {
          if (!line.empty() && line.back() == '\r') line.pop_back();
          const size_t colon = line.find(':');
          if (colon == std::string::npos) continue;
          const std::string name = to_lower(trim(std::string_view(line).substr(0, colon)));
          const std::string value = trim(std::string_view(line).substr(colon + 1));
          if (name == "content-length") {
            content_length = static_cast<size_t>(std::stoul(value));
            break;
          }
        }
      }
    }

    if (header_end != std::string::npos && raw.size() >= header_end + 4 + content_length) break;
    if (raw.size() > 2'000'000) throw std::runtime_error("request too large");
  }

  std::istringstream stream(raw.substr(0, header_end));
  HttpRequest request;
  stream >> request.method >> request.target;
  request.method = to_lower(request.method);
  std::ranges::transform(request.method, request.method.begin(), [](unsigned char ch) { return static_cast<char>(std::toupper(ch)); });

  const size_t query_pos = request.target.find('?');
  request.path = query_pos == std::string::npos ? request.target : request.target.substr(0, query_pos);
  request.query = query_pos == std::string::npos ? "" : request.target.substr(query_pos + 1);

  std::string line;
  std::getline(stream, line);
  while (std::getline(stream, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const size_t colon = line.find(':');
    if (colon == std::string::npos) continue;
    request.headers[to_lower(trim(std::string_view(line).substr(0, colon)))] = trim(std::string_view(line).substr(colon + 1));
  }
  request.body = raw.substr(header_end + 4, content_length);
  return request;
}

void send_response(socket_t client, const HttpResponse& response) {
  std::ostringstream headers;
  headers << "HTTP/1.1 " << response.status << " " << response.status_text << "\r\n";
  headers << "Content-Type: " << response.content_type << "\r\n";
  headers << "Content-Length: " << response.body.size() << "\r\n";
  headers << "Access-Control-Allow-Origin: *\r\n";
  headers << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n";
  headers << "Access-Control-Allow-Headers: Content-Type\r\n";
  headers << "Connection: close\r\n\r\n";
  const auto header_text = headers.str();
  send_socket(client, header_text.data(), static_cast<int>(header_text.size()));
  if (!response.body.empty()) send_socket(client, response.body.data(), static_cast<int>(response.body.size()));
}

void handle_client(DictionaryServerState& state, socket_t client) {
  try {
    const auto request = read_request(client);
    if (!request) {
      close_socket(client);
      return;
    }
    send_response(client, route_request(state, *request));
  } catch (const std::exception& err) {
    send_response(client, json_response("{\"error\":" + quoted(err.what()) + "}", 500, "Internal Server Error"));
  }
  close_socket(client);
}

int parse_port_arg(std::string_view value) {
  int port = 3031;
  const auto result = std::from_chars(value.data(), value.data() + value.size(), port);
  if (result.ec != std::errc{} || port <= 0 || port > 65535) throw std::runtime_error("invalid port");
  return port;
}

} // namespace

int main(int argc, char** argv) {
  int port = 3031;
  fs::path data_root = fs::current_path() / "dictionaries";
  std::string language = "ja";

  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    if (arg == "--port" && i + 1 < argc) {
      port = parse_port_arg(argv[++i]);
    } else if (arg == "--data-dir" && i + 1 < argc) {
      data_root = fs::path(argv[++i]);
    } else if (arg == "--language" && i + 1 < argc) {
      language = argv[++i];
    } else if (arg == "--help") {
      std::cout << "Usage: moku-hoshidicts-http --port 3031 --data-dir ./dictionaries --language ja\n";
      return 0;
    }
  }

  DictionaryServerState state;
  state.data_root = data_root;
  state.language = language;
  state.reload();

  if (!socket_startup()) {
    std::cerr << "Failed to initialize sockets\n";
    return 1;
  }

  socket_t server = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (server == invalid_socket_value) {
    std::cerr << "Failed to create socket\n";
    socket_cleanup();
    return 1;
  }

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(static_cast<uint16_t>(port));
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

  int yes = 1;
#ifdef _WIN32
  setsockopt(server, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof(yes));
#else
  setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
#endif

  if (bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::cerr << "Failed to bind 127.0.0.1:" << port << "\n";
    close_socket(server);
    socket_cleanup();
    return 1;
  }

  if (listen(server, 32) != 0) {
    std::cerr << "Failed to listen on 127.0.0.1:" << port << "\n";
    close_socket(server);
    socket_cleanup();
    return 1;
  }

  std::cout << "Moku hoshidicts server running at http://127.0.0.1:" << port << "\n";
  std::cout << "Dictionary root: " << path_utf8(data_root) << "\n";

  while (true) {
    socket_t client = accept(server, nullptr, nullptr);
    if (client == invalid_socket_value) continue;
    std::thread(handle_client, std::ref(state), client).detach();
  }

  close_socket(server);
  socket_cleanup();
  return 0;
}
