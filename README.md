# Practo Doctors Scraper

Extract comprehensive doctor profiles from Practo with verified information including specialities, ratings, experience, consultation fees, and patient reviews. This scraper is optimized for high performance using JSON API with intelligent HTML fallback.

## Why Choose This Scraper?

<ul>
  <li><strong>Verified Medical Data:</strong> Extract accurate doctor information from India's leading healthcare platform</li>
  <li><strong>Dual Extraction Method:</strong> Prioritizes JSON API for speed, falls back to HTML parsing for reliability</li>
  <li><strong>Advanced Filtering:</strong> Filter by experience, ratings, location, and speciality</li>
  <li><strong>Complete Profiles:</strong> Get consultation fees, patient stories, clinic details, and more</li>
  <li><strong>Production Ready:</strong> Built with enterprise-grade error handling and retry logic</li>
</ul>

## What Data Can You Extract?

This scraper provides detailed information about medical professionals:

<table>
  <thead>
    <tr>
      <th>Field</th>
      <th>Description</th>
      <th>Type</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>name</strong></td>
      <td>Doctor's full name with credentials</td>
      <td>text</td>
    </tr>
    <tr>
      <td><strong>speciality</strong></td>
      <td>Medical specialization (e.g., Dermatologist, Cardiologist)</td>
      <td>text</td>
    </tr>
    <tr>
      <td><strong>experience</strong></td>
      <td>Years of professional experience</td>
      <td>number</td>
    </tr>
    <tr>
      <td><strong>rating</strong></td>
      <td>Patient satisfaction rating (percentage)</td>
      <td>number</td>
    </tr>
    <tr>
      <td><strong>consultationFee</strong></td>
      <td>Consultation fee in Indian Rupees (₹)</td>
      <td>number</td>
    </tr>
    <tr>
      <td><strong>location</strong></td>
      <td>Practice locality within city</td>
      <td>text</td>
    </tr>
    <tr>
      <td><strong>city</strong></td>
      <td>City where doctor practices</td>
      <td>text</td>
    </tr>
    <tr>
      <td><strong>patientStories</strong></td>
      <td>Number of verified patient reviews</td>
      <td>number</td>
    </tr>
    <tr>
      <td><strong>clinicName</strong></td>
      <td>Hospital or clinic name</td>
      <td>text</td>
    </tr>
    <tr>
      <td><strong>url</strong></td>
      <td>Direct link to doctor's Practo profile</td>
      <td>url</td>
    </tr>
  </tbody>
</table>

## Use Cases

<dl>
  <dt><strong>Healthcare Market Research</strong></dt>
  <dd>Analyze doctor availability, pricing trends, and speciality distribution across cities</dd>
  
  <dt><strong>Medical Tourism Planning</strong></dt>
  <dd>Identify highly-rated specialists with extensive experience for international patients</dd>
  
  <dt><strong>Healthcare Analytics</strong></dt>
  <dd>Build databases for healthcare accessibility studies and comparative analysis</dd>
  
  <dt><strong>Lead Generation</strong></dt>
  <dd>Find contact information for healthcare business development and partnerships</dd>
  
  <dt><strong>Competitive Intelligence</strong></dt>
  <dd>Monitor consultation fees, ratings, and market positioning of medical professionals</dd>
</dl>

## Input Configuration

Configure your scraping requirements using these parameters:

### Basic Parameters

<dl>
  <dt><code>speciality</code> (string, optional)</dt>
  <dd>
    <p>Medical specialization to search for. Supports all Practo specialities.</p>
    <p><strong>Examples:</strong> dermatologist, cardiologist, dentist, gynecologist, orthopedist, pediatrician, psychiatrist</p>
    <p><strong>Default:</strong> dermatologist</p>
  </dd>
  
  <dt><code>city</code> (string, optional)</dt>
  <dd>
    <p>Target city for doctor search. Use lowercase city names.</p>
    <p><strong>Examples:</strong> bangalore, delhi, mumbai, pune, hyderabad, chennai, kolkata</p>
    <p><strong>Default:</strong> bangalore</p>
  </dd>
  
  <dt><code>locality</code> (string, optional)</dt>
  <dd>
    <p>Specific neighborhood or area within the city for refined search.</p>
    <p><strong>Examples:</strong> koramangala, indiranagar, whitefield</p>
    <p><strong>Default:</strong> empty (city-wide search)</p>
  </dd>
  
  <dt><code>startUrl</code> (string, optional)</dt>
  <dd>
    <p>Direct Practo listing URL. Overrides speciality and city parameters when provided.</p>
    <p><strong>Example:</strong> https://www.practo.com/bangalore/dermatologist/koramangala</p>
  </dd>
</dl>

### Filtering & Limits

<dl>
  <dt><code>results_wanted</code> (integer, optional)</dt>
  <dd>
    <p>Maximum number of doctor profiles to extract.</p>
    <p><strong>Default:</strong> 100</p>
    <p><strong>Range:</strong> 1 - unlimited</p>
  </dd>
  
  <dt><code>max_pages</code> (integer, optional)</dt>
  <dd>
    <p>Safety limit on pagination depth to prevent runaway scraping.</p>
    <p><strong>Default:</strong> 10</p>
    <p><strong>Recommended:</strong> 5-20 pages</p>
  </dd>
  
  <dt><code>minExperience</code> (integer, optional)</dt>
  <dd>
    <p>Filter doctors by minimum years of professional experience.</p>
    <p><strong>Default:</strong> 0 (no filter)</p>
    <p><strong>Example:</strong> 10 (only doctors with 10+ years experience)</p>
  </dd>
  
  <dt><code>minRating</code> (integer, optional)</dt>
  <dd>
    <p>Filter by minimum patient satisfaction rating percentage.</p>
    <p><strong>Default:</strong> 0 (no filter)</p>
    <p><strong>Range:</strong> 0-100</p>
    <p><strong>Example:</strong> 85 (only doctors with 85%+ rating)</p>
  </dd>
</dl>

### Proxy Configuration

<dl>
  <dt><code>proxyConfiguration</code> (object, optional)</dt>
  <dd>
    <p>Proxy settings for reliable data extraction. Residential proxies strongly recommended.</p>
    <p><strong>Default:</strong> Apify Residential Proxies</p>
  </dd>
</dl>

## Input Examples

### Example 1: Basic Dermatologist Search

```json
{
  "speciality": "dermatologist",
  "city": "bangalore",
  "results_wanted": 50
}
```

### Example 2: Filtered Cardiologist Search

```json
{
  "speciality": "cardiologist",
  "city": "delhi",
  "minExperience": 15,
  "minRating": 90,
  "results_wanted": 30
}
```

### Example 3: Locality-Specific Search

```json
{
  "speciality": "dentist",
  "city": "mumbai",
  "locality": "andheri",
  "results_wanted": 100,
  "max_pages": 5
}
```

### Example 4: Direct URL Search

```json
{
  "startUrl": "https://www.practo.com/pune/gynecologist",
  "minRating": 85,
  "results_wanted": 75
}
```

## Output Format

### Sample Output Record

```json
{
  "name": "Dr. Parthasarathi Dutta Roy",
  "speciality": "Dermatologist",
  "experience": 22,
  "rating": 98,
  "consultationFee": 800,
  "location": "Magrath Road, Bangalore",
  "city": "bangalore",
  "patientStories": 4981,
  "clinicName": "Dr. Partha Sarathi's Asian Hair And Skin Hospitals",
  "url": "https://www.practo.com/bangalore/doctor/dr-partha-sarathi-dutta-roy-dermatologist-cosmetologist-dermatologist"
}
```

### Output Schema

All extracted records follow this consistent structure:

<ul>
  <li><code>name</code>: Doctor's full professional name</li>
  <li><code>speciality</code>: Medical specialization field</li>
  <li><code>experience</code>: Years of practice (integer)</li>
  <li><code>rating</code>: Patient satisfaction percentage (0-100)</li>
  <li><code>consultationFee</code>: Fee in INR (integer, may be null)</li>
  <li><code>location</code>: Practice area/locality</li>
  <li><code>city</code>: City of practice</li>
  <li><code>patientStories</code>: Count of verified reviews (integer)</li>
  <li><code>clinicName</code>: Associated medical facility</li>
  <li><code>url</code>: Canonical profile URL</li>
</ul>

## How It Works

<ol>
  <li><strong>URL Construction:</strong> Builds target URLs from speciality and city parameters</li>
  <li><strong>Smart Extraction:</strong> Attempts JSON API extraction first for maximum speed</li>
  <li><strong>HTML Fallback:</strong> If API fails, parses HTML structure with robust selectors</li>
  <li><strong>Data Validation:</strong> Applies experience and rating filters to results</li>
  <li><strong>Pagination:</strong> Automatically follows next-page links until limits reached</li>
  <li><strong>Dataset Storage:</strong> Saves verified records to Apify dataset</li>
</ol>

## Performance & Limits

<table>
  <tr>
    <td><strong>Average Speed</strong></td>
    <td>15-20 doctors per minute</td>
  </tr>
  <tr>
    <td><strong>Recommended Concurrency</strong></td>
    <td>5 parallel requests (default)</td>
  </tr>
  <tr>
    <td><strong>Memory Usage</strong></td>
    <td>Low (512MB sufficient for most runs)</td>
  </tr>
  <tr>
    <td><strong>Timeout</strong></td>
    <td>90 seconds per page</td>
  </tr>
  <tr>
    <td><strong>Retry Logic</strong></td>
    <td>3 automatic retries on failure</td>
  </tr>
</table>

## Best Practices

### For Optimal Results

<ul>
  <li><strong>Use Residential Proxies:</strong> Provides best success rates and avoids rate limiting</li>
  <li><strong>Set Reasonable Limits:</strong> Keep <code>results_wanted</code> under 500 per run for stability</li>
  <li><strong>Filter Strategically:</strong> Use <code>minExperience</code> and <code>minRating</code> to reduce data volume</li>
  <li><strong>Monitor Runs:</strong> Check logs for API vs HTML extraction ratio</li>
  <li><strong>Respect Rate Limits:</strong> Avoid running multiple instances simultaneously on same target</li>
</ul>

### Common Issues & Solutions

<dl>
  <dt>No results returned</dt>
  <dd>
    <ul>
      <li>Verify speciality spelling matches Practo's format (lowercase, no spaces)</li>
      <li>Check if city name is correct and supported</li>
      <li>Try removing locality filter for broader results</li>
    </ul>
  </dd>
  
  <dt>Incomplete data fields</dt>
  <dd>
    <ul>
      <li>Some doctors don't display all information publicly</li>
      <li>Consultation fees may be unavailable for certain profiles</li>
      <li>This is expected behavior, not a scraper error</li>
    </ul>
  </dd>
  
  <dt>Slow extraction speed</dt>
  <dd>
    <ul>
      <li>Enable proxy configuration if not already active</li>
      <li>Reduce <code>max_pages</code> for faster completion</li>
      <li>HTML fallback is slower than API - this is normal</li>
    </ul>
  </dd>
</dl>

## API Endpoint Information

This scraper intelligently uses Practo's internal API when available:

<ul>
  <li><strong>Primary Method:</strong> JSON API via HTTP requests (faster, structured)</li>
  <li><strong>Fallback Method:</strong> HTML parsing with Cheerio (reliable, comprehensive)</li>
  <li><strong>Automatic Selection:</strong> Chooses best method per request</li>
</ul>

## Data Compliance

<blockquote>
  <p><strong>Important:</strong> This scraper extracts publicly available information from Practo's platform. Users are responsible for:</p>
  <ul>
    <li>Complying with Practo's Terms of Service</li>
    <li>Adhering to data protection regulations (GDPR, DPDPA, etc.)</li>
    <li>Using extracted data ethically and legally</li>
    <li>Not overwhelming the platform with excessive requests</li>
  </ul>
  <p>Medical data is sensitive. Handle responsibly and respect privacy regulations.</p>
</blockquote>

## Support & Feedback

Need help or have suggestions? 

<ul>
  <li>Check the <strong>Issues</strong> tab for common problems</li>
  <li>Review execution logs for detailed error messages</li>
  <li>Ensure input parameters match expected formats</li>
  <li>Contact support for technical assistance</li>
</ul>

---

<p align="center">
  <strong>Built for reliable medical data extraction from India's leading healthcare platform</strong>
</p>
